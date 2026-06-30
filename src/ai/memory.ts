/**
 * F1: Infinite Wallet Memory (File Mode).
 *
 * Every user message, assistant reply, and tool call is persisted to 0G Storage
 * as a single rolling snapshot file per user. The AI agent can retrieve any past
 * interaction via the `search_history` tool, enabling questions like "what did I
 * do yesterday?"
 *
 * Architecture: One rolling snapshot per user on 0G Storage (via fileStorage.ts).
 *   - Each write uploads the full history as a new snapshot.
 *   - A local index file (OG_STORAGE_INDEX_PATH) maps userId → latest rootHash.
 *   - If the index is lost, the data is still on 0G (just harder to find).
 *
 * Memory is best-effort: if 0G Storage is unavailable, we log a warning and
 * continue (the bot must never crash due to a memory write failure).
 */

import { config } from '../config';
import { uploadJson, downloadJson, clearIndex } from '../og/fileStorage';

// ───────────────────────────────────────────────────────────────────────
// TYPES (preserved — other files import these)
// ───────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export interface StoredMessage {
  role: MessageRole;
  content: string;
  ts: number;
}

export interface StoredToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ts: number;
}

export interface StoredTx {
  type: 'send' | 'receive' | 'create' | 'swap';
  amount?: string;
  to?: string;
  from?: string;
  hash: string;
  ts: number;
}

/**
 * Cryptographic proof that an AI reply was generated inside a TEE.
 * `verified === true` means the provider's TEE signer signed the response
 * and the signature checked out; `false` means it was signed but failed
 * verification; `null` means verification was not attempted (e.g. fallback
 * mode or `processResponse` threw).
 */
export interface StoredProof {
  chatID: string;
  providerAddress: string;
  verified: boolean | null;
  ts: number;
}

export type MemoryEntry =
  | { kind: 'msg'; data: StoredMessage }
  | { kind: 'tool'; data: StoredToolCall }
  | { kind: 'tx'; data: StoredTx }
  | { kind: 'proof'; data: StoredProof };

/** Search result type: flattened entry with a `kind` discriminator. */
export type SearchEntry = (StoredMessage | StoredToolCall | StoredTx | StoredProof) & {
  kind: 'msg' | 'tool' | 'tx' | 'proof';
};

// ───────────────────────────────────────────────────────────────────────
// Internal: Snapshot structure stored on 0G
// ───────────────────────────────────────────────────────────────────────

interface HistorySnapshot {
  entries: MemoryEntry[];
}

// In-memory cache
const cache = new Map<string, HistorySnapshot>();
const loadingPromises = new Map<string, Promise<HistorySnapshot>>();

function memoryEnabled(): boolean {
  return config.OG_MEMORY_ENABLED;
}

/**
 * Load a user's history (cache first, then 0G Storage).
 * Deduplicates concurrent loads for the same user.
 */
async function loadHistory(userId: string): Promise<HistorySnapshot> {
  if (!memoryEnabled()) return { entries: [] };

  // 1. Return if cached
  const cached = cache.get(userId);
  if (cached) return cached;

  // 2. Dedup concurrent loads
  const pending = loadingPromises.get(userId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await downloadJson<HistorySnapshot>(userId);
      const snapshot: HistorySnapshot = data || { entries: [] };
      cache.set(userId, snapshot);
      return snapshot;
    } catch (e) {
      console.warn(`[memory] loadHistory failed for user=${userId}:`, (e as Error).message);
      return { entries: [] };
    }
  })();

  loadingPromises.set(userId, promise);
  try {
    return await promise;
  } finally {
    loadingPromises.delete(userId);
  }
}

/**
 * Maximum number of entries to keep per user.
 * When exceeded, the oldest entries are pruned before upload.
 * Set to 0 to disable compaction.
 */
const MAX_ENTRIES = config.OG_MEMORY_MAX_ENTRIES;

/**
 * Compact a user's history by pruning the oldest entries.
 * Keeps the most recent MAX_ENTRIES entries (FIFO).
 * Logs if compaction actually prunes anything.
 */
function compact(userId: string, history: HistorySnapshot): void {
  if (MAX_ENTRIES <= 0) return;
  const before = history.entries.length;
  if (before <= MAX_ENTRIES) return;
  const removed = before - MAX_ENTRIES;
  history.entries = history.entries.slice(-MAX_ENTRIES);
  console.log(`[memory] compacted user=${userId}: pruned ${removed} entries (${before} → ${MAX_ENTRIES})`);
}

/**
 * Save history back to 0G Storage (best-effort).
 * Compacts before uploading so the snapshot size stays bounded.
 */
async function saveHistory(userId: string, history: HistorySnapshot): Promise<void> {
  if (!memoryEnabled()) return;
  compact(userId, history);
  cache.set(userId, history);
  try {
    await uploadJson(userId, history);
  } catch (e) {
    console.warn(`[memory] saveHistory failed for user=${userId}:`, (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────

/**
 * Persist a user or assistant message to 0G Storage.
 */
export async function recordMessage(
  userId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'msg',
    data: { ts: Date.now(), role, content },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

/**
 * Persist a tool call (the LLM requested a function, we executed it).
 */
export async function recordToolCall(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'tool',
    data: { ts: Date.now(), tool, args, result },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

/**
 * Persist an on-chain transaction (for future use when send_tokens is added).
 */
export async function recordTx(
  userId: string,
  tx: Omit<StoredTx, 'ts'>,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'tx',
    data: { ...tx, ts: Date.now() },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

/**
 * Persist a TEE-verification proof for an AI reply.
 *
 * Called by `aiHandler` after every final assistant turn. Like the other
 * record* functions, the 0G Storage write is fire-and-forget — the cache is
 * already updated synchronously so subsequent reads see the proof.
 */
export async function recordProof(
  userId: string,
  proof: Omit<StoredProof, 'ts'>,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'proof',
    data: { ...proof, ts: Date.now() },
  });
  saveHistory(userId, history).catch(() => {});
}

/**
 * Get the N most recent MESSAGE entries for a user.
 *
 * Returns a chronological array (oldest first, newest last), useful for
 * passing as LLM conversation history.
 */
export async function getRecent(
  userId: string,
  limit: number = config.OG_MEMORY_CONTEXT_WINDOW,
): Promise<StoredMessage[]> {
  const history = await loadHistory(userId);
  const msgs = history.entries
    .filter((e): e is MemoryEntry & { kind: 'msg' } => e.kind === 'msg')
    .map((e) => e.data as StoredMessage);
  return msgs.slice(-limit);
}

/**
 * Get the most recent TEE-verification proofs for a user, newest first.
 * Powers the `/proof` command.
 */
export async function getRecentProofs(
  userId: string,
  limit: number = 10,
): Promise<StoredProof[]> {
  const history = await loadHistory(userId);
  const proofs = history.entries
    .filter((e): e is MemoryEntry & { kind: 'proof' } => e.kind === 'proof')
    .map((e) => e.data as StoredProof);
  // Newest first
  proofs.sort((a, b) => b.ts - a.ts);
  return proofs.slice(0, limit);
}

/**
 * Search a user's memory by free-text query and/or time range.
 *
 * @param userId   Telegram user ID
 * @param query    Optional substring to match (case-insensitive) against content
 * @param fromTs   Optional Unix-ms timestamp lower bound (inclusive)
 * @param toTs     Optional Unix-ms timestamp upper bound (inclusive)
 * @param limit    Max results to return (default: config.OG_MEMORY_SEARCH_LIMIT)
 * @returns        Array of matching entries (newest first), each tagged with `kind`
 */
export async function search(
  userId: string,
  query?: string,
  fromTs?: number,
  toTs?: number,
  limit: number = config.OG_MEMORY_SEARCH_LIMIT,
): Promise<SearchEntry[]> {
  const history = await loadHistory(userId);
  const results: SearchEntry[] = [];

  for (const entry of history.entries) {
    const data = entry.data;

    // Time filter
    if (fromTs && data.ts < fromTs) continue;
    if (toTs && data.ts > toTs) continue;

    // Text filter
    if (query) {
      const q = query.toLowerCase();
      let haystack = '';
      if (entry.kind === 'msg') {
        haystack = (data as StoredMessage).content.toLowerCase();
      } else if (entry.kind === 'tool') {
        const t = data as StoredToolCall;
        haystack = `${t.tool} ${JSON.stringify(t.args)} ${JSON.stringify(t.result)}`.toLowerCase();
      } else if (entry.kind === 'tx') {
        const tx = data as StoredTx;
        haystack = `${tx.type} ${tx.amount ?? ''} ${tx.to ?? ''} ${tx.hash}`.toLowerCase();
      }
      if (!haystack.includes(q)) continue;
    }

    results.push({ ...data, kind: entry.kind });
  }

  // Sort newest first, then apply limit
  results.sort((a, b) => b.ts - a.ts);
  return results.slice(0, limit);
}

/**
 * Clear all memory for a user.
 *
 * Clears the in-memory cache and the local root-hash index.
 * The actual snapshot data on 0G Storage is immutable (cannot be deleted) —
 * but we forget the rootHash, so we can no longer find it.
 */
export async function clearMemory(userId: string): Promise<void> {
  cache.delete(userId);
  if (memoryEnabled()) {
    await clearIndex(userId);
  }
}
