/**
 * Verified Intent Receipt service.
 *
 * Two lifecycle patterns across the five action types:
 *
 *  Stage → finalize (send, swap):
 *   stageSendReceipt()/stageSwapReceipt() — called when the action is staged
 *                     (prepareSend/prepareSwap). Creates an in-memory receipt
 *                     with status='staged'. Does NOT upload.
 *   finalizeReceipt() — called after the on-chain tx confirms (executeSend/
 *                       executeSwap). Sets txHash + user_confirmed=pass,
 *                       uploads to 0G Storage under `receipt:<receiptId>`
 *                       (its own rootHash), indexes it, caches it.
 *   cancelReceipt()  — marks a staged receipt cancelled (drops it; no upload).
 *   failReceipt()    — marks a staged receipt failed (signer load/tx revert).
 *
 *  Create-and-upload (dca, alert, key_reveal):
 *   createDcaCreationReceipt() / createDcaExecutionReceipt()
 *   createAlertCreationReceipt() / createAlertFireReceipt()
 *   createKeyRevealReceipt()     — LOCAL-ONLY (never uploads to 0G Storage).
 *   Each builds the receipt fully-formed and uploads it immediately via
 *   emitReceipt() (or, for key-reveal, indexes locally only).
 *
 * 0G Storage reuse: receipts are uploaded via the SAME fileStorage.uploadJson
 * queue that serializes memory-snapshot uploads. This is mandatory — every
 * upload uses the operator wallet, so concurrent uploads would race on nonce.
 * Reusing the queue avoids a second serialization layer. The receipt's
 * `receipt:<id>` namespace key sits alongside user-snapshot keys in the same
 * root-hash index, so /verify/:root recovers receipts with no new lookup code.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { uploadJson, downloadJson, downloadByRootHash } from '../og/fileStorage';
import * as store from './receiptStore';
import {
  RECEIPT_VERSION,
  type ComputeLeg,
  type DcaReceipt,
  type IntentReceipt,
  type KeyRevealReceipt,
  type NftMintReceipt,
  type RiskCheck,
  type SendReceipt,
  type SwapReceipt,
  type AlertReceipt,
} from './types';

// In-memory cache: staged + finalized receipts (receiptId → receipt).
// Staged receipts live ONLY here until finalized; finalized receipts are also
// on 0G Storage (when enabled) and in the local receiptStore index.
const cache = new Map<string, IntentReceipt>();

// ─── Stage (pre-confirmation) ────────────────────────────────────────────────

export interface StageSendInput {
  userId: string;
  amount: string;
  recipientKind: 'address' | 'username';
  resolvedUsername?: string;
  resolvedAddress: string;
  walletId: string;
  walletName: string;
  rawInput?: string;
  source: 'command' | 'nl' | 'button';
}

function buildUserIntentRaw(input: StageSendInput): string {
  if (input.rawInput && input.rawInput.trim()) return input.rawInput.trim();
  const recipient =
    input.recipientKind === 'username' && input.resolvedUsername
      ? `@${input.resolvedUsername}`
      : input.resolvedAddress;
  return `send ${input.amount} OG to ${recipient}`;
}

/**
 * Create a staged receipt for a send. Returns the receiptId (also stored on
 * the pending send so executeSend can finalize it). Does not touch 0G Storage.
 */
export function stageSendReceipt(input: StageSendInput): string {
  const receiptId = randomUUID();
  const now = Date.now();
  const recipientValue =
    input.recipientKind === 'username' && input.resolvedUsername
      ? `@${input.resolvedUsername}`
      : input.resolvedAddress;

  const checks: RiskCheck[] = [
    { check: 'recipient_resolved', status: 'pass', ts: now },
    { check: 'balance_ok', status: 'pass', ts: now },
    { check: 'user_confirmed', status: 'pending', ts: now },
  ];

  const receipt: SendReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'send',
    userId: input.userId,
    status: 'staged',
    createdAt: now,
    userIntent: {
      raw: buildUserIntentRaw(input),
      source: input.source,
    },
    parsedIntent: {
      type: 'send',
      amount: input.amount,
      asset: 'OG',
      recipient: {
        kind: input.recipientKind,
        value: recipientValue,
        resolvedAddress: input.resolvedAddress,
      },
      fromWalletId: input.walletId,
      fromWalletName: input.walletName,
    },
    riskChecks: checks,
    compute: null,
    confirmation: {
      required: true,
      method: 'telegram_inline_button',
    },
    chain: {},
    storage: {},
  };

  cache.set(receiptId, receipt);
  // Index the staged meta so /receipt can list it even before finalization.
  store
    .add({
      receiptId,
      userId: input.userId,
      actionType: 'send',
      status: 'staged',
      createdAt: now,
    })
    .catch(() => {});
  return receiptId;
}

// ─── Stage a swap receipt (pre-confirmation) ──────────────────────────────────

export interface StageSwapInput {
  userId: string;
  kind: 'wrap' | 'unwrap' | 'dex';
  fromToken: string;
  toToken: string;
  amountIn: string;
  estOut: string;
  walletId: string;
  walletName: string;
  rawInput?: string;
  source: 'command' | 'nl' | 'button';
  // DEX-only:
  minOut?: string;
  slippageBps?: number;
  path?: string[];
  routeKind?: 'native-to-token' | 'token-to-native' | 'token-to-token';
  approvalNeeded?: boolean;
}

/**
 * Create a staged receipt for a swap (wrap / unwrap / DEX). Returns the
 * receiptId (stored on the pending swap so executeSwap can finalize it).
 * Does not touch 0G Storage.
 *
 * Risk checks:
 *   - balance_ok: pass (prepareSwap already validated sufficient balance)
 *   - user_confirmed: pending (set to pass on Confirm tap)
 *   - approval_ok: n/a for wrap/unwrap; pending for DEX token-to-token swaps
 *     that require an ERC-20 approval (set to pass inside executeSwap after
 *     ensureAllowance succeeds)
 */
export function stageSwapReceipt(input: StageSwapInput): string {
  const receiptId = randomUUID();
  const now = Date.now();

  const checks: RiskCheck[] = [
    { check: 'balance_ok', status: 'pass', ts: now },
    { check: 'user_confirmed', status: 'pending', ts: now },
  ];
  if (input.approvalNeeded) {
    checks.push({ check: 'approval_ok', status: 'pending', ts: now });
  } else {
    checks.push({ check: 'approval_ok', status: 'n/a', ts: now });
  }

  const rawIntent =
    input.rawInput && input.rawInput.trim()
      ? input.rawInput.trim()
      : `${input.kind === 'wrap' ? 'wrap' : input.kind === 'unwrap' ? 'unwrap' : 'swap'} ${input.amountIn} ${input.fromToken} → ${input.toToken}`;

  const receipt: SwapReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'swap',
    userId: input.userId,
    status: 'staged',
    createdAt: now,
    userIntent: { raw: rawIntent, source: input.source },
    parsedIntent: {
      type: 'swap',
      kind: input.kind,
      fromToken: input.fromToken,
      toToken: input.toToken,
      amountIn: input.amountIn,
      estOut: input.estOut,
      minOut: input.minOut,
      slippageBps: input.slippageBps,
      path: input.path,
      routeKind: input.routeKind,
      approvalNeeded: input.approvalNeeded,
      fromWalletId: input.walletId,
      fromWalletName: input.walletName,
    },
    riskChecks: checks,
    compute: null,
    confirmation: { required: true, method: 'telegram_inline_button' },
    chain: {},
    storage: {},
  };

  cache.set(receiptId, receipt);
  store
    .add({
      receiptId,
      userId: input.userId,
      actionType: 'swap',
      status: 'staged',
      createdAt: now,
    })
    .catch(() => {});
  return receiptId;
}

/** Mark the approval_ok risk check as pass (called after ensureAllowance succeeds). */
export function markApprovalOk(receiptId: string): void {
  const receipt = cache.get(receiptId);
  if (!receipt) return;
  const now = Date.now();
  for (const c of receipt.riskChecks) {
    if (c.check === 'approval_ok') {
      c.status = 'pass';
      c.ts = now;
    }
  }
}

// ─── DCA + Alert receipts (create-and-upload in one shot — no staging) ──────────
// Unlike send/swap (which stage a receipt pre-Confirm then finalize post-tx),
// DCA and alert receipts are created and finalized immediately:
//   - DCA creation: emitted when the user schedules a DCA (no on-chain action)
//   - DCA execution: emitted after each scheduled swap fires (has txHash)
//   - Alert creation: emitted when the user arms an alert (no on-chain action)
//   - Alert fire: emitted when the condition is met (notification proof, no tx)

export interface CreateResult {
  receiptId: string;
  rootHash: string | null;
}

/** Build a receipt object, upload it to 0G Storage, index it. Returns id + rootHash. */
async function emitReceipt(receipt: IntentReceipt): Promise<CreateResult> {
  const receiptId = receipt.receiptId;
  cache.set(receiptId, receipt);

  let rootHash: string | null = null;
  if (config.OG_STORAGE_ENABLED) {
    try {
      rootHash = await uploadJson(`receipt:${receiptId}`, receipt);
      receipt.storage.rootHash = rootHash;
    } catch (e) {
      console.warn(
        `[receipts] 0G Storage upload failed for receipt=${receiptId}:`,
        (e as Error).message,
      );
    }
  }

  await store.add({
    receiptId,
    userId: receipt.userId,
    actionType: receipt.actionType,
    status: receipt.status,
    createdAt: receipt.createdAt,
    finalizedAt: receipt.finalizedAt,
    rootHash: rootHash ?? undefined,
  });

  return { receiptId, rootHash };
}

// ─── DCA creation receipt ────────────────────────────────────────────────────

export interface DcaCreationInput {
  userId: string;
  intentId: string;
  fromToken: string;
  toToken: string;
  amount: string;
  scheduleRaw: string;
  scheduleIntervalMs: number;
  walletId: string;
  walletName?: string;
  rawInput?: string;
  compute?: ComputeLeg | null;
}

export async function createDcaCreationReceipt(input: DcaCreationInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const checks: RiskCheck[] = [
    { check: 'path_supported', status: 'pass', ts: now },
    { check: 'schedule_parsed', status: 'pass', ts: now },
    { check: 'wallet_ok', status: 'pass', ts: now },
  ];
  const raw =
    input.rawInput && input.rawInput.trim()
      ? input.rawInput.trim()
      : `dca ${input.amount} ${input.fromToken} into ${input.toToken} ${input.scheduleRaw}`;

  const receipt: DcaReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'dca',
    userId: input.userId,
    status: 'created',
    createdAt: now,
    finalizedAt: now,
    userIntent: { raw, source: 'nl' },
    parsedIntent: {
      type: 'dca',
      fromToken: input.fromToken,
      toToken: input.toToken,
      amount: input.amount,
      scheduleRaw: input.scheduleRaw,
      scheduleIntervalMs: input.scheduleIntervalMs,
      walletId: input.walletId,
      walletName: input.walletName,
    },
    riskChecks: checks,
    compute: input.compute ?? null,
    confirmation: {
      required: true,
      method: 'implicit_schedule',
      confirmedAt: now,
    },
    intentLink: { intentId: input.intentId },
    chain: {},
    storage: {},
  };
  return emitReceipt(receipt);
}

// ─── DCA execution receipt ──────────────────────────────────────────────────

export interface DcaExecutionInput {
  userId: string;
  intentId: string;
  creationReceiptId?: string;
  fromToken: string;
  toToken: string;
  amount: string;
  scheduleRaw: string;
  scheduleIntervalMs: number;
  walletId: string;
  walletName?: string;
  txHash: string;
}

export async function createDcaExecutionReceipt(input: DcaExecutionInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const checks: RiskCheck[] = [
    { check: 'balance_ok', status: 'pass', ts: now },
    { check: 'swap_executed', status: 'pass', ts: now },
  ];

  const receipt: DcaReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'dca',
    userId: input.userId,
    status: 'executed',
    createdAt: now,
    finalizedAt: now,
    userIntent: {
      raw: `DCA execution (automatic): ${input.amount} ${input.fromToken} → ${input.toToken}`,
      source: 'automatic',
    },
    parsedIntent: {
      type: 'dca',
      fromToken: input.fromToken,
      toToken: input.toToken,
      amount: input.amount,
      scheduleRaw: input.scheduleRaw,
      scheduleIntervalMs: input.scheduleIntervalMs,
      walletId: input.walletId,
      walletName: input.walletName,
    },
    riskChecks: checks,
    compute: null,
    confirmation: {
      required: false,
      method: 'automatic_scheduled',
    },
    intentLink: {
      intentId: input.intentId,
      creationReceiptId: input.creationReceiptId,
    },
    chain: { txHash: input.txHash },
    storage: {},
  };
  return emitReceipt(receipt);
}

// ─── Alert creation receipt ──────────────────────────────────────────────────

export interface AlertCreationInput {
  userId: string;
  intentId: string;
  symbol: string;
  coingeckoId: string;
  operator: '<' | '>' | '<=' | '>=';
  threshold: number;
  rawInput?: string;
  compute?: ComputeLeg | null;
}

export async function createAlertCreationReceipt(input: AlertCreationInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const opWord =
    input.operator === '<' ? 'below' :
    input.operator === '>' ? 'above' :
    input.operator === '<=' ? 'at or below' : 'at or above';
  const checks: RiskCheck[] = [
    { check: 'symbol_resolved', status: 'pass', ts: now },
    { check: 'condition_valid', status: 'pass', ts: now },
  ];
  const raw =
    input.rawInput && input.rawInput.trim()
      ? input.rawInput.trim()
      : `alert me if ${input.symbol} goes ${opWord} $${input.threshold}`;

  const receipt: AlertReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'alert',
    userId: input.userId,
    status: 'armed',
    createdAt: now,
    finalizedAt: now,
    userIntent: { raw, source: 'nl' },
    parsedIntent: {
      type: 'alert',
      symbol: input.symbol,
      coingeckoId: input.coingeckoId,
      operator: input.operator,
      threshold: input.threshold,
    },
    riskChecks: checks,
    compute: input.compute ?? null,
    confirmation: {
      required: true,
      method: 'implicit_schedule',
      confirmedAt: now,
    },
    intentLink: { intentId: input.intentId },
    chain: {},
    storage: {},
  };
  return emitReceipt(receipt);
}

// ─── Alert fire receipt ────────────────────────────────────────────────────

export interface AlertFireInput {
  userId: string;
  intentId: string;
  creationReceiptId?: string;
  symbol: string;
  coingeckoId: string;
  operator: '<' | '>' | '<=' | '>=';
  threshold: number;
  triggerPrice: number;
  priceSource: string;
}

export async function createAlertFireReceipt(input: AlertFireInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const checks: RiskCheck[] = [
    { check: 'price_source_ok', status: 'pass', ts: now },
    { check: 'condition_met', status: 'pass', ts: now },
    { check: 'notification_sent', status: 'pass', ts: now },
  ];

  const receipt: AlertReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'alert',
    userId: input.userId,
    status: 'fired',
    createdAt: now,
    finalizedAt: now,
    userIntent: {
      raw: `Alert fired (automatic): ${input.symbol} ${input.operator} $${input.threshold}`,
      source: 'automatic',
    },
    parsedIntent: {
      type: 'alert',
      symbol: input.symbol,
      coingeckoId: input.coingeckoId,
      operator: input.operator,
      threshold: input.threshold,
      triggerPrice: input.triggerPrice,
      priceSource: input.priceSource,
    },
    riskChecks: checks,
    compute: null,
    confirmation: {
      required: false,
      method: 'automatic_scheduled',
    },
    intentLink: {
      intentId: input.intentId,
      creationReceiptId: input.creationReceiptId,
    },
    notification: {
      method: 'telegram_message',
      sentAt: now,
      chatId: input.userId,
    },
    chain: {},
    storage: {},
  };
  return emitReceipt(receipt);
}

// ─── Key-reveal receipt (LOCAL-ONLY — never uploaded to 0G Storage) ──────────

export interface KeyRevealInput {
  userId: string;
  walletId: string;
  walletName: string;
  walletAddress: string;
  revealMethod: 'command_privatekey' | 'button_export' | 'button_new_wallet' | 'command_wallet';
  secretKind: 'private_key' | 'recovery_phrase';
}

/**
 * Create a key-reveal receipt. LOCAL-ONLY: indexes in the local receiptStore
 * + caches in-memory, but NEVER uploads to 0G Storage (sensitive metadata
 * about key reveals should not live on public immutable storage).
 *
 * The receipt contains only redacted metadata — never the key itself.
 * Risk checks: `user_confirmed` (the user explicitly triggered the reveal via
 * command or button) and `no_ai_access` (the key never touched the LLM —
 * reveal is a deterministic command/button flow, not an AI tool).
 */
export async function createKeyRevealReceipt(input: KeyRevealInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const checks: RiskCheck[] = [
    { check: 'user_confirmed', status: 'pass', ts: now },
    { check: 'no_ai_access', status: 'pass', ts: now },
  ];

  const methodLabel =
    input.revealMethod === 'command_privatekey' ? '/privatekey command' :
    input.revealMethod === 'button_export' ? 'Settings → Export private key' :
    input.revealMethod === 'button_new_wallet' ? 'New wallet button' :
    '/wallet command';

  const receipt: KeyRevealReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'key_reveal',
    userId: input.userId,
    status: 'revealed',
    createdAt: now,
    finalizedAt: now,
    userIntent: {
      raw: `Reveal ${input.secretKind === 'recovery_phrase' ? 'recovery phrase' : 'private key'} for ${input.walletName} (${methodLabel})`,
      source: input.revealMethod.startsWith('command') ? 'command' : 'button',
    },
    parsedIntent: {
      type: 'key_reveal',
      walletId: input.walletId,
      walletName: input.walletName,
      walletAddress: input.walletAddress,
      revealMethod: input.revealMethod,
      secretKind: input.secretKind,
    },
    riskChecks: checks,
    compute: null,
    confirmation: {
      required: true,
      method: 'telegram_inline_button',
      confirmedAt: now,
    },
    chain: {},
    storage: {},
  };

  // Local-only: cache + index, but NO 0G Storage upload.
  cache.set(receiptId, receipt);
  await store.add({
    receiptId,
    userId: input.userId,
    actionType: 'key_reveal',
    status: 'revealed',
    createdAt: now,
    finalizedAt: now,
  });
  console.log(`[receipts] key-reveal receipt ${receiptId} created (local-only) for user=${input.userId} wallet=${input.walletId}`);
  return { receiptId, rootHash: null };
}

// ─── Finalize (post-confirmation, post-tx) ────────────────────────────────────

export interface FinalizeResult {
  receipt: IntentReceipt;
  rootHash: string | null;
}

// ─── NFT mint receipt (create-and-upload in one shot — no staging) ──────────────────
//
// Like DCA/alert creation, the NFT mint happens automatically — there is no
// explicit user Confirm button. The factory fully constructs the receipt and
// uploads via emitReceipt(), which routes through the same uploadJson queue as
// every other 0G Storage write (so the operator wallet's nonce is serialized).
export interface CreateNftMintInput {
  userId: string;
  walletId: string;
  walletName: string;
  walletAddress: string;
  tokenId: string;
  tokenURI: string;
  metadataStorageRootHash?: string | null;
  txHash: string;
}

export async function createNftMintReceipt(input: CreateNftMintInput): Promise<CreateResult> {
  const receiptId = randomUUID();
  const now = Date.now();
  const checks: RiskCheck[] = [
    { check: 'wallet_first_creation', status: 'pass', ts: now },
    { check: 'no_existing_profile', status: 'pass', ts: now },
    {
      check: 'metadata_uploaded',
      status: input.metadataStorageRootHash ? 'pass' : 'n/a',
      ts: now,
    },
  ];
  const receipt: NftMintReceipt = {
    version: RECEIPT_VERSION,
    receiptId,
    actionType: 'nft_mint',
    userId: input.userId,
    status: 'minted',
    createdAt: now,
    finalizedAt: now,
    userIntent: {
      raw: `mint profile NFT for ${input.walletName} (${input.walletAddress.slice(0, 8)}…)`,
      source: 'automatic',
    },
    parsedIntent: {
      type: 'nft_mint',
      walletId: input.walletId,
      walletName: input.walletName,
      walletAddress: input.walletAddress,
      tokenId: input.tokenId,
      tokenURI: input.tokenURI,
      metadataStorageRootHash: input.metadataStorageRootHash ?? undefined,
    },
    riskChecks: checks,
    compute: null,
    confirmation: {
      required: false,
      method: 'automatic',
    },
    chain: { txHash: input.txHash },
    storage: {},
  };
  return emitReceipt(receipt);
}

/**
 * Finalize a staged receipt after the on-chain tx confirms:
 *   - mark user_confirmed=pass with the confirm timestamp
 *   - set chain.txHash
 *   - upload the full receipt to 0G Storage under `receipt:<receiptId>`
 *   - update the local index with rootHash + status='executed'
 *
 * If 0G Storage is disabled, the receipt is still finalized in-memory + indexed
 * locally with no rootHash (durable only for the session / local index).
 */
export async function finalizeReceipt(
  receiptId: string,
  txHash: string,
): Promise<FinalizeResult | null> {
  const receipt = cache.get(receiptId);
  if (!receipt) return null;

  const now = Date.now();
  receipt.status = 'executed';
  receipt.finalizedAt = now;
  receipt.chain.txHash = txHash;

  for (const c of receipt.riskChecks) {
    if (c.check === 'user_confirmed') {
      c.status = 'pass';
      c.ts = now;
    }
  }
  receipt.confirmation.confirmedAt = now;

  let rootHash: string | null = null;
  if (config.OG_STORAGE_ENABLED) {
    try {
      rootHash = await uploadJson(`receipt:${receiptId}`, receipt);
      receipt.storage.rootHash = rootHash;
    } catch (e) {
      console.warn(
        `[receipts] 0G Storage upload failed for receipt=${receiptId}:`,
        (e as Error).message,
      );
    }
  }

  await store.update(receiptId, {
    status: 'executed',
    rootHash: rootHash ?? undefined,
    finalizedAt: now,
  });
  return { receipt, rootHash };
}

/** Mark a staged receipt as cancelled (drops it from the in-memory cache). */
export async function cancelReceipt(receiptId: string): Promise<void> {
  cache.delete(receiptId);
  await store.update(receiptId, { status: 'cancelled' });
}

/** Mark a staged receipt as failed (tx reverted, signer load failed, etc.). */
export async function failReceipt(receiptId: string, reason: string): Promise<void> {
  const receipt = cache.get(receiptId);
  if (receipt) {
    receipt.status = 'failed';
    receipt.finalizedAt = Date.now();
    cache.delete(receiptId);
  }
  await store.update(receiptId, { status: 'failed', finalizedAt: Date.now() });
  console.warn(`[receipts] receipt ${receiptId} marked failed: ${reason}`);
}

// ─── Recovery ────────────────────────────────────────────────────────────────

/** Recover a full receipt by receiptId (memory cache → 0G Storage). */
export async function getReceipt(receiptId: string): Promise<IntentReceipt | null> {
  const cached = cache.get(receiptId);
  if (cached) return cached;
  if (!config.OG_STORAGE_ENABLED) return null;
  try {
    return await downloadJson<IntentReceipt>(`receipt:${receiptId}`);
  } catch {
    return null;
  }
}

/** Recover a full receipt by 0G Storage rootHash. */
export async function getReceiptByRootHash(
  rootHash: string,
): Promise<IntentReceipt | null> {
  // Fast path: the local index knows this rootHash → fetch by receiptId.
  const meta = await store.getByRootHash(rootHash);
  if (meta) return getReceipt(meta.receiptId);
  if (!config.OG_STORAGE_ENABLED) return null;
  // Fallback: scan the fileStorage root-hash index (cross-user).
  try {
    const raw = await downloadByRootHash(rootHash);
    return raw ? (JSON.parse(raw) as IntentReceipt) : null;
  } catch {
    return null;
  }
}

