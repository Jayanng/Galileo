import dotenv from 'dotenv';
dotenv.config({ override: true });
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

  // 0G Storage (optional in this phase)
  OG_STORAGE_ENABLED: boolEnv(false),
  OG_INDEXER_RPC: z.string().url().default('https://indexer-storage-testnet-turbo.0g.ai'),
  OG_KV_RPC: z.string().default('http://3.101.147.150:6789'),
  OG_STREAM_ID: z.string().default(''),
  OG_FLOW_CONTRACT: z.string().default('0x22E03a6A89B950F1c82ec5e74F8eCa321a105296'),

  // 0G Compute (Router path — OpenAI-compatible)
  OG_COMPUTE_API_KEY: z
    .string()
    .min(1, 'OG_COMPUTE_API_KEY is required (get one at https://pc.testnet.0g.ai)'),
  OG_COMPUTE_BASE_URL: z
    .string()
    .url()
    .default('https://router-api-testnet.integratenetwork.work/v1'),
  OG_COMPUTE_MODEL: z.string().default('qwen/qwen2.5-omni-7b'),

  // F1: Infinite Wallet Memory (0G Storage KV)
  OG_MEMORY_ENABLED: boolEnv(true),
  OG_MEMORY_CONTEXT_WINDOW: z.coerce.number().int().positive().default(10),
  OG_MEMORY_SEARCH_LIMIT: z.coerce.number().int().positive().default(20),

  // F1 Compaction: max entries per user before oldest are pruned.
  // Each entry is ~200-500 bytes, so 1000 entries ≈ 200-500 KB per user.
  // Set to 0 to disable compaction (not recommended — unbounded growth).
  OG_MEMORY_MAX_ENTRIES: z.coerce.number().int().min(0).default(1000),

  // F1 File Mode: local cache mapping userId → latest 0G Storage rootHash
  OG_STORAGE_INDEX_PATH: z.string().default('.data/root-index.json'),

  // Swaps
  WOG_ADDRESS: z.string().default(''),
  DEX_ROUTER_ADDRESS: z.string().default(''),
  SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(5000).default(50),
  SWAP_DEADLINE_SECS: z.coerce.number().int().positive().default(600),
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
  if (cfg.OG_STORAGE_ENABLED && !cfg.OG_STREAM_ID) {
    throw new Error(
      'OG_STORAGE_ENABLED=true requires OG_STREAM_ID to be set ' +
        '(see the 0G Storage docs — KV wallet storage needs a stream id).',
    );
  }
  return cfg;
}

export const config = load();

