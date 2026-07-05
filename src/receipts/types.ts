/**
 * F5: Verified Intent Receipt — the single artifact that proves an end-to-end
 * user action: natural-language (or command) intent → deterministic parse →
 * risk checks → explicit user confirmation → on-chain tx → 0G Storage root.
 *
 * Phase 1 realized the `send` action type. Phase 2 adds `swap`. Phase 3 adds
 * `dca` (multi-event: creation + N executions) and `alert` (creation + fire).
 * The schema is a discriminated union keyed on `actionType`; DCA/alert
 * additionally discriminate on `phase`.
 *
 * Design notes:
 *   - `compute` is null for command-driven actions (send/swap/dca/alert are
 *     NOT AI tools per README.md:251 — keys never reach the LLM). The receipt
 *     still proves intent→parse→confirm→tx; it just lacks the TEE leg.
 *   - `riskChecks` are structured `{check, status, ts}` rather than flat labels
 *     so each check carries pass/fail evidence + timestamp (a real proof, not
 *     a checklist). Swap adds `approval_ok`; DCA adds `schedule_parsed`,
 *     `path_supported`, `swap_executed`; alert adds `symbol_resolved`,
 *     `condition_valid`, `price_source_ok`, `condition_met`, `notification_sent`.
 *   - `storage.rootHash` is set when the receipt artifact is uploaded to 0G
 *     Storage under its own namespace (`receipt:<receiptId>`), making it
 *     independently recoverable via `/verify/:rootHash` — immune to the rolling
 *     memory snapshot's MAX_ENTRIES compaction.
 *   - `intentLink` connects multi-event receipts: DCA execution receipts link
 *     to their creation receipt; alert fire receipts link to their creation
 *     receipt. Send/swap receipts are standalone (no intentLink).
 *   - `notification` is present only on alert fire receipts — proves the
 *     Telegram message was sent (method, timestamp, chatId).
 */

import { z } from 'zod';

export const RECEIPT_VERSION = 1;

// ─── Shared sub-schemas ─────────────────────────────────────────────────────

export const RiskCheckSchema = z.object({
  check: z.enum([
    'recipient_resolved', 'balance_ok', 'user_confirmed', 'approval_ok',
    // DCA
    'path_supported', 'schedule_parsed', 'wallet_ok', 'swap_executed',
    // Alert
    'symbol_resolved', 'condition_valid', 'price_source_ok', 'condition_met',
    'notification_sent',
    // Key reveal
    'no_ai_access',
    // NFT mint
    'wallet_first_creation', 'no_existing_profile', 'metadata_uploaded',
    // Cancellation (DCA/alert cancel receipts)
    'intent_found',
    // Recurring send
    'send_executed',
  ]),
  status: z.enum(['pass', 'fail', 'pending', 'n/a']),
  ts: z.number().int().nonnegative(),
});
export type RiskCheck = z.infer<typeof RiskCheckSchema>;

export const ComputeLegSchema = z.object({
  provider: z.string(),
  verified: z.boolean(),
  chatId: z.string(),
});
export type ComputeLeg = z.infer<typeof ComputeLegSchema>;

export const UserIntentSchema = z.object({
  raw: z.string(),
  source: z.enum(['command', 'nl', 'button', 'automatic']),
});
export type UserIntent = z.infer<typeof UserIntentSchema>;

export const ConfirmationSchema = z.object({
  required: z.boolean(),
  method: z.enum([
    'telegram_inline_button',
    'implicit_schedule',
    'automatic_scheduled',
    // NFT mint (and any other zero-touch automatic action)
    'automatic',
  ]),
  confirmedAt: z.number().int().nonnegative().optional(),
});
export type Confirmation = z.infer<typeof ConfirmationSchema>;

/** Links an execution/fire receipt back to its creation receipt. */
export const IntentLinkSchema = z.object({
  intentId: z.string(),
  creationReceiptId: z.string().optional(),
});
export type IntentLink = z.infer<typeof IntentLinkSchema>;

/** Notification proof (present only on alert fire receipts). */
export const NotificationSchema = z.object({
  method: z.literal('telegram_message'),
  sentAt: z.number().int().nonnegative(),
  chatId: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/**
 * On-chain settlement reference. `blockNumber` is populated when the F5
 * pipeline observes a tx confirm (send/swap/dca execution/nft mint) so the
 * /verify page can fetch the canonical block timestamp and display it
 * alongside the tx hash. Optional for backward compat with receipts that
 * predate the field (they were issued without a blockNumber).
 */
export const ChainSchema = z.object({
  txHash: z.string().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
});
export type Chain = z.infer<typeof ChainSchema>;

// ─── Send receipt ────────────────────────────────────────────────────────────

export const SendReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('send'),
  userId: z.string().min(1),
  status: z.enum(['staged', 'executed', 'cancelled', 'failed']),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: z.object({
    type: z.literal('send'),
    amount: z.string(),
    asset: z.literal('OG'),
    recipient: z.object({
      kind: z.enum(['address', 'username']),
      value: z.string(),
      resolvedAddress: z.string(),
    }),
    fromWalletId: z.string(),
    fromWalletName: z.string(),
  }),
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type SendReceipt = z.infer<typeof SendReceiptSchema>;

// ─── Swap receipt ─────────────────────────────────────────────────────────────

export const SwapParsedIntentSchema = z.object({
  type: z.literal('swap'),
  kind: z.enum(['wrap', 'unwrap', 'dex']),
  fromToken: z.string(),
  toToken: z.string(),
  amountIn: z.string(),
  estOut: z.string(),
  // DEX-only fields (absent for wrap/unwrap, which are 1:1):
  minOut: z.string().optional(),
  slippageBps: z.number().int().nonnegative().optional(),
  path: z.array(z.string()).optional(),
  routeKind: z.enum(['native-to-token', 'token-to-native', 'token-to-token']).optional(),
  approvalNeeded: z.boolean().optional(),
  fromWalletId: z.string(),
  fromWalletName: z.string(),
});
export type SwapParsedIntent = z.infer<typeof SwapParsedIntentSchema>;

export const SwapReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('swap'),
  userId: z.string().min(1),
  status: z.enum(['staged', 'executed', 'cancelled', 'failed']),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: SwapParsedIntentSchema,
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type SwapReceipt = z.infer<typeof SwapReceiptSchema>;

// ─── DCA receipt (creation + execution phases) ──────────────────────────────

export const DcaParsedIntentSchema = z.object({
  type: z.literal('dca'),
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.string(),
  scheduleRaw: z.string(),
  scheduleIntervalMs: z.number().int().positive(),
  walletId: z.string(),
  walletName: z.string().optional(),
});
export type DcaParsedIntent = z.infer<typeof DcaParsedIntentSchema>;

export const DcaReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('dca'),
  userId: z.string().min(1),
  status: z.enum(['created', 'executed', 'cancelled', 'failed']),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: DcaParsedIntentSchema,
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  intentLink: IntentLinkSchema.optional(),
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type DcaReceipt = z.infer<typeof DcaReceiptSchema>;

// ─── Alert receipt (creation + fire phases) ──────────────────────────────────

export const AlertParsedIntentSchema = z.object({
  type: z.literal('alert'),
  symbol: z.string(),
  coingeckoId: z.string(),
  operator: z.enum(['<', '>', '<=', '>=']),
  threshold: z.number().positive(),
  // Fire-only fields:
  triggerPrice: z.number().optional(),
  priceSource: z.string().optional(),
});
export type AlertParsedIntent = z.infer<typeof AlertParsedIntentSchema>;

export const AlertReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('alert'),
  userId: z.string().min(1),
  status: z.enum(['armed', 'fired', 'cancelled', 'failed']),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: AlertParsedIntentSchema,
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  intentLink: IntentLinkSchema.optional(),
  notification: NotificationSchema.optional(),
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type AlertReceipt = z.infer<typeof AlertReceiptSchema>;

// ─── Key-reveal receipt (LOCAL-ONLY — never uploaded to 0G Storage) ──────────
//
// Proves that a private key was revealed to the user at a specific time, via
// a specific trigger, with NO AI involvement (the key never touched the LLM).
// Contains only redacted metadata — never the key itself. Stored in the local
// receiptStore index + in-memory cache; the `storage.rootHash` field is always
// absent because this receipt is never uploaded to 0G Storage (sensitive
// metadata about key reveals should not live on public immutable storage).

export const KeyRevealParsedIntentSchema = z.object({
  type: z.literal('key_reveal'),
  walletId: z.string(),
  walletName: z.string(),
  walletAddress: z.string(),
  revealMethod: z.enum([
    'command_privatekey',      // /privatekey → pk:<id> callback
    'button_export',           // Settings → Export private key
    'button_new_wallet',       // New wallet (creation reveals key)
    'command_wallet',          // /wallet (creation reveals key)
  ]),
  secretKind: z.enum(['private_key', 'recovery_phrase']),
});
export type KeyRevealParsedIntent = z.infer<typeof KeyRevealParsedIntentSchema>;

export const KeyRevealReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('key_reveal'),
  userId: z.string().min(1),
  status: z.enum(['revealed']),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: KeyRevealParsedIntentSchema,
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type KeyRevealReceipt = z.infer<typeof KeyRevealReceiptSchema>;

// NFT mint receipt ────────────────────────────────────────────────────────────
//
// Emitted by `createNftMintReceipt` after the on-chain `mint()` confirms during
// a user's first wallet creation. Proves that the bot minted a GalileoProfileNFT
// to a specific wallet address on a specific tx, and (separately) where the NFT
// metadata JSON lives. The receipt itself lives on 0G Storage under its own
// `receipt:<id>` key, recoverable from `/verify/:rootHash`.
//
// The mint is automatic (no separate user confirmation step), so
// `confirmation.method` is `'automatic'` and `required` is false. Compute leg
// is null because wallet creation does not route through the AI agent — neither
// the `create_wallet` AI tool path nor the NFT mint touch 0G Compute.

export const NftMintParsedIntentSchema = z.object({
  type: z.literal('nft_mint'),
  walletId: z.string(),
  walletName: z.string(),
  walletAddress: z.string(),
  tokenId: z.string(),
  // '0g://<rootHash>' when metadata was uploaded to 0G Storage; otherwise the
  // data URI used as fallback. The full metadata JSON is also carried.
  tokenURI: z.string(),
  metadataStorageRootHash: z.string().optional(),
});
export type NftMintParsedIntent = z.infer<typeof NftMintParsedIntentSchema>;

export const NftMintReceiptSchema = z.object({
  version: z.literal(RECEIPT_VERSION),
  receiptId: z.string().min(1),
  actionType: z.literal('nft_mint'),
  userId: z.string().min(1),
  status: z.literal('minted'),
  createdAt: z.number().int().nonnegative(),
  finalizedAt: z.number().int().nonnegative().optional(),

  userIntent: UserIntentSchema,
  parsedIntent: NftMintParsedIntentSchema,
  riskChecks: z.array(RiskCheckSchema),
  compute: ComputeLegSchema.nullable(),
  confirmation: ConfirmationSchema,
  chain: ChainSchema,
  storage: z.object({ rootHash: z.string().optional() }),
});
export type NftMintReceipt = z.infer<typeof NftMintReceiptSchema>;

// ─── Union ──────────────────────────────────────────────────────────────────

export type IntentReceipt =
  | SendReceipt
  | SwapReceipt
  | DcaReceipt
  | AlertReceipt
  | KeyRevealReceipt
  | NftMintReceipt;
export type ActionType = IntentReceipt['actionType'];
export type ReceiptStatus = IntentReceipt['status'];

const RECEIPT_ACTION_TYPES = new Set([
  'send', 'swap', 'dca', 'alert', 'key_reveal', 'nft_mint',
]);

/** True when a parsed JSON object looks like a Galileo receipt artifact. */
export function looksLikeReceipt(obj: unknown): obj is IntentReceipt {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as any;
  return (
    o.version === RECEIPT_VERSION &&
    typeof o.receiptId === 'string' &&
    typeof o.actionType === 'string' &&
    RECEIPT_ACTION_TYPES.has(o.actionType)
  );
}
