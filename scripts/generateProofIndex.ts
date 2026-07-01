/**
 * generateProofIndex.ts
 *
 * Cron-able script that reads all user memory snapshots from 0G Storage and
 * writes `public/proofs.json` with the last 50 user-anonymized proof samples.
 *
 * Each entry exposes:
 *   - txHash / chainscan link     (from StoredTx entries)
 *   - storageRootHash / indexer   (from the root-hash index)
 *   - teeChatID                   (from StoredProof entries)
 *
 * The output is served at GET /proofs by the health endpoint.
 *
 * Usage:
 *   npx tsx scripts/generateProofIndex.ts
 *
 * Suggested cron schedule (every 6 hours):
 *   0 0,6,12,18 * * * cd /path/to/project && npx tsx scripts/generateProofIndex.ts
 *
 * The script reads:
 *   - OG_STORAGE_INDEX_PATH  → userId → rootHash mapping
 *   - Each user's history    → StoredProof + StoredTx entries
 *
 * It anonymizes by stripping userId and collapsing timestamps to nearest hour.
 *
 * NOTE: Config is loaded from the environment (with defaults in config.ts).
 * The index file path defaults to '.data/root-index.json' if unset, so the
 * script can run from the project root with or without a full .env.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { config } from '../src/config.js';
import { downloadJson } from '../src/og/fileStorage.js';

// ── Types (mirrored from memory.ts so this script has no circular dep) ──

interface StoredProof {
  chatID: string;
  providerAddress: string;
  verified: boolean | null;
  ts: number;
}

interface StoredTx {
  type: 'send' | 'receive' | 'create' | 'swap';
  amount?: string;
  to?: string;
  from?: string;
  hash: string;
  ts: number;
}

interface ProofIndexEntry {
  /** Anonymized user ID (hash of real userId). */
  userHash: string;
  /** Approximate timestamp (ISO, rounded to nearest hour). */
  ts: string;
  /** TEE chat ID from 0G Compute. null if the proof has no chatID. */
  teeChatID: string | null;
  /** On-chain transaction hash (from StoredTx). null if none recorded nearby. */
  txHash: string | null;
  /** ChainScan explorer URL for the txHash. */
  chainscanLink: string | null;
  /** 0G Storage rootHash for this user's snapshot. null if unavailable. */
  storageRootHash: string | null;
  /** 0G Storage explorer link for the rootHash. */
  storageExplorerLink: string | null;
  /** Whether the TEE signature was verified. */
  verified: boolean | null;
}

interface ProofIndexFile {
  /** ISO timestamp when this index was generated. */
  generatedAt: string;
  /** Total number of users scanned. */
  userCount: number;
  /** Total number of proof entries across all users. */
  totalProofs: number;
  /** Up to 50 anonymized entries (newest first). */
  entries: ProofIndexEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────

const CHAINSCAN_BASE = 'https://chainscan-galileo.0g.ai';
const STORAGE_EXPLORER = 'https://scan.0g.ai';

/** Resolve a path relative to this script (Node 20 compatible). */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Stable salt for userId anonymization. Pulled from PROOFS_HASH_SALT env var
 * (set via `fly secrets` in production, dummy in CI). Stable across runs so
 * the same userId produces the same userHash — preserves the audit trail
 * ("this is the same user as last time" without revealing who).
 *
 * Falls back to a hardcoded dev-only string when unset, which logs a warning
 * if NODE_ENV=production (see main()).
 */
const HASH_SALT = config.PROOFS_HASH_SALT ?? 'dev-only-insecure-salt';

/**
 * Salted SHA-256 truncated to 12 hex chars (48 bits of entropy — overkill for
 * distinguishing a few hundred users, compact for a JSON field).
 *
 * Not a cryptographic commitment. A leaked salt + small userId space (e.g.
 * Telegram IDs ~9 digits) can be brute-forced. Treat userHash as best-effort
 * anonymization, not encryption.
 */
function hashUserId(userId: string): string {
  const digest = createHash('sha256')
    .update(HASH_SALT + ':' + userId)
    .digest('hex');
  return `u${digest.slice(0, 12)}`;
}

/** Round a timestamp down to the nearest hour for privacy. */
function roundToHour(ts: number): string {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (HASH_SALT === 'dev-only-insecure-salt' && process.env.NODE_ENV === 'production') {
    console.warn(
      '[generateProofIndex] WARNING: using dev fallback hash salt in production. ' +
        'Set PROOFS_HASH_SALT to a long random string.',
    );
  }
  console.log('[generateProofIndex] starting...');

  // 1. Read the root-hash index to discover all users
  let indexData: Record<string, string> = {};
  try {
    const raw = await fs.readFile(config.OG_STORAGE_INDEX_PATH, 'utf8');
    indexData = JSON.parse(raw) as Record<string, string>;
  } catch (e) {
    console.warn(
      `[generateProofIndex] could not read index at ${config.OG_STORAGE_INDEX_PATH}: ${(e as Error).message}`,
    );
    console.log('[generateProofIndex] writing empty index — no users yet.');
  }

  const userIds = Object.keys(indexData);
  console.log(`[generateProofIndex] found ${userIds.length} user(s) in index`);

  // 2. Load each user's history and collect proofs + txs
  const allEntries: ProofIndexEntry[] = [];

  for (const userId of userIds) {
    const rootHash = indexData[userId];
    if (!rootHash) continue;

    try {
      const history = await downloadJson<{
        entries: Array<{ kind: string; data: Record<string, unknown> }>;
      }>(userId);
      if (!history || !Array.isArray(history.entries)) continue;

      const userHash = hashUserId(userId);

      // Collect proofs
      const proofs: StoredProof[] = history.entries
        .filter((e) => e.kind === 'proof')
        .map((e) => e.data as unknown as StoredProof);

      // Collect recent tx hashes
      const txs: StoredTx[] = history.entries
        .filter((e) => e.kind === 'tx')
        .map((e) => e.data as unknown as StoredTx);

      // For each proof, try to find a nearby tx (within 5 minutes)
      // teeChatID is intentionally raw — it's a TEE session ID from the 0G
      // Compute provider, not a user identifier. Correlating it requires
      // access to the provider's logs, which is out of scope for this feed.
      for (const proof of proofs) {
        const nearbyTx = txs.find((tx) => Math.abs(tx.ts - proof.ts) < 5 * 60 * 1000);
        const storageLink = rootHash ? `${STORAGE_EXPLORER}?root=${rootHash}` : null;

        allEntries.push({
          userHash,
          ts: roundToHour(proof.ts),
          teeChatID: proof.chatID ?? null,
          txHash: nearbyTx?.hash ?? null,
          chainscanLink: nearbyTx?.hash ? `${CHAINSCAN_BASE}/tx/${nearbyTx.hash}` : null,
          storageRootHash: rootHash,
          storageExplorerLink: storageLink,
          verified: proof.verified,
        });
      }

      // Also add tx-only entries (txs without nearby proofs)
      for (const tx of txs) {
        const hasNearbyProof = proofs.some((p) => Math.abs(p.ts - tx.ts) < 5 * 60 * 1000);
        if (hasNearbyProof) continue;

        const storageLink = rootHash ? `${STORAGE_EXPLORER}?root=${rootHash}` : null;

        allEntries.push({
          userHash,
          ts: roundToHour(tx.ts),
          teeChatID: null,
          txHash: tx.hash,
          chainscanLink: `${CHAINSCAN_BASE}/tx/${tx.hash}`,
          storageRootHash: rootHash,
          storageExplorerLink: storageLink,
          verified: null,
        });
      }
    } catch (e) {
      console.warn(`[generateProofIndex] error reading user ${hashUserId(userId)}: ${(e as Error).message}`);
    }
  }

  // 3. Sort newest first, limit to 50
  allEntries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const top50 = allEntries.slice(0, 50);

  // 4. Write the public index
  const output: ProofIndexFile = {
    generatedAt: new Date().toISOString(),
    userCount: userIds.length,
    totalProofs: allEntries.length,
    entries: top50,
  };

  const outPath = resolve(__dirname, '..', 'public', 'proofs.json');
  await fs.mkdir(dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`[generateProofIndex] wrote ${top50.length} entries to ${outPath}`);
  console.log(`[generateProofIndex] done (${userIds.length} users, ${allEntries.length} total samples)`);
}

main().catch((e) => {
  console.error('[generateProofIndex] fatal:', (e as Error).message);
  process.exit(1);
});
