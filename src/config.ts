import dotenv from 'dotenv';
dotenv.config();
import { dirname, join } from 'node:path';
import { z } from 'zod';

const truthy = new Set(['1', 'true', 'yes', 'on']);
const boolEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : truthy.has(v.toLowerCase())));

// Accept a private key with or without the 0x prefix, normalise to 0x-form.
const hexPrivateKey = z
  .string()
  .min(1, 'OPERATOR_PRIVATE_KEY is required')
  .transform((s) => (s.startsWith('0x') ? s : `0x${s}`))
  .refine((s) => /^0x[0-9a-fA-F]{64}$/.test(s), 'must be a 32-byte (64 hex char) private key');

const schema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required (get one from @BotFather)'),

  // 0G Chain
  OPERATOR_PRIVATE_KEY: hexPrivateKey,
  OG_RPC: z.string().url().default('https://evmrpc-testnet.0g.ai'),
  OG_CHAIN_ID: z.coerce.number().int().positive().default(16602),
  WALLET_GAS_DRIP: z.string().default('0'),

  // Key custody
  WALLET_ENCRYPTION_KEY: z
    .string()
    .min(16, 'WALLET_ENCRYPTION_KEY should be a long random secret (>= 16 chars)'),
  WALLET_STORE_PATH: z.string().default('.data/wallets.json'),

  // 0G Storage (optional in this phase) — file mode only
  OG_STORAGE_ENABLED: boolEnv(true),
  OG_INDEXER_RPC: z.string().url().default('https://indexer-storage-testnet-turbo.0g.ai'),

  // 0G Compute — official 0g-compute-ts-sdk broker (TEE-verifiable inference)
  OG_COMPUTE_API_KEY: z
    .string()
    .min(1, 'OG_COMPUTE_API_KEY is required (get one at https://pc.testnet.0g.ai)'),
  OG_COMPUTE_BASE_URL: z
    .string()
    .url()
    .default('https://router-api-testnet.integratenetwork.work/v1'),
  OG_COMPUTE_MODEL: z.string().default('qwen/qwen2.5-omni-7b'),

  // When true, skip the SDK broker and call OG_COMPUTE_BASE_URL directly.
  // No TEE verification is possible in this mode. Keep as a temporary fallback.
  OG_COMPUTE_FALLBACK: boolEnv(false),

  // Amount of OG to top up the selected provider's inference sub-account at
  // startup when balance is below this threshold. Units are in OG (not neuron).
  // Set to 1 OG to exceed on-chain MIN_TRANSFER_AMOUNT_CONTRACT=1 while keeping
  // automatic top-ups fast and affordable. The auto-top-up mechanism in
  // chatVerified() refills whenever the sub-account drops below this threshold.
  OG_COMPUTE_FUND_AMOUNT: z.string().default('1'),

  // Optional explicit provider address. If set, the broker skips discovery and
  // uses this provider. Must still satisfy serviceType='chatbot' and
  // verifiability='TeeML' filters.
  OG_COMPUTE_PROVIDER_ADDRESS: z.string().default(''),

  // F1: Infinite Wallet Memory (0G Storage)
  OG_MEMORY_ENABLED: boolEnv(true),
  OG_MEMORY_CONTEXT_WINDOW: z.coerce.number().int().positive().default(10),
  OG_MEMORY_SEARCH_LIMIT: z.coerce.number().int().positive().default(20),

  // F1 Compaction: max entries per user before oldest are pruned.
  // Each entry is ~200-500 bytes, so 1000 entries ≈ 200-500 KB per user.
  // Set to 0 to disable compaction (not recommended — unbounded growth).
  OG_MEMORY_MAX_ENTRIES: z.coerce.number().int().min(0).default(1000),

  // F1 Upload batching: debounce window for memory snapshot uploads.
  // Instead of uploading on every record* call (4-5 per user turn), we wait
  // this many ms after the last write before uploading — collapsing a burst
  // into a single 0G Storage tx. Only memory snapshots are debounced; F5
  // receipts upload immediately (their rootHash is surfaced to the user).
  OG_MEMORY_UPLOAD_DEBOUNCE_MS: z.coerce.number().int().positive().default(2000),

  // F1 Upload batching: max delay before a debounced upload is force-flushed,
  // even if writes keep coming. Ensures a snapshot eventually persists during
  // sustained activity. Must be > OG_MEMORY_UPLOAD_DEBOUNCE_MS.
  OG_MEMORY_UPLOAD_MAX_WAIT_MS: z.coerce.number().int().positive().default(10000),

  // F1 File Mode: local cache mapping userId → latest 0G Storage rootHash.
  // When unset, it is derived to sit BESIDE the wallet store (see load() below),
  // so it always lands on the same persistent volume — otherwise a restart wipes
  // the index and all recorded history becomes unfindable on 0G Storage.
  OG_STORAGE_INDEX_PATH: z.string().default(''),

  // F5 Verified Intent Receipts: local index mapping receiptId →
  // { rootHash, userId, actionType, status, createdAt }. Lets /receipt list a
  // user's receipts and /verify/:root render them without scanning 0G Storage.
  // Derived beside the wallet store (same persistent volume) when unset.
  OG_RECEIPT_INDEX_PATH: z.string().default(''),

  // Privacy: salt for anonymizing userIds in the public proofs.json feed.
  // Optional — scripts/generateProofIndex.ts falls back to a dev-only string
  // (which warns loudly in production). Set via `fly secrets` in production
  // so hashes stay stable across deploys. Not a credential — see DEPLOY.md.
  PROOFS_HASH_SALT: z.string().min(16).optional(),

  // Swaps
  WOG_ADDRESS: z.string().default(''),
  DEX_ROUTER_ADDRESS: z.string().default(''),
  DEX_FACTORY_ADDRESS: z.string().default(''),
  USDC_ADDRESS: z.string().default(''),
  USDT_ADDRESS: z.string().default(''),
  SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(5000).default(50),
  SWAP_DEADLINE_SECS: z.coerce.number().int().positive().default(600),

  // Profile NFT — soulbound ERC-721 identity badge per user.
  // Deploy via scripts/deployNft.mjs and set the printed address here.
  // Leave blank to disable NFT minting (bot works fine without it).
  NFT_CONTRACT_ADDRESS: z.string().default(''),
});

export type AppConfig = z.infer<typeof schema>;

function load(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the required values.',
    );
  }
  const cfg = parsed.data;
  // F1 memory index must live on the same persistent volume as the wallet store.
  // If not set explicitly, place it next to WALLET_STORE_PATH (mirrors active.json).
  // Without this, the default landed on the ephemeral rootfs and every restart/
  // redeploy wiped the userId → rootHash map, making recorded txs unfindable.
  if (!cfg.OG_STORAGE_INDEX_PATH) {
    cfg.OG_STORAGE_INDEX_PATH = join(dirname(cfg.WALLET_STORE_PATH), 'root-index.json');
  }
  if (!cfg.OG_RECEIPT_INDEX_PATH) {
    cfg.OG_RECEIPT_INDEX_PATH = join(dirname(cfg.WALLET_STORE_PATH), 'receipts-index.json');
  }
  return cfg;
}

export const config = load();

