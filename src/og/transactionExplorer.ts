import type { TransactionReceipt, TransactionResponse } from 'ethers';
import { provider, formatOG } from './chain';
import { config } from '../config';

/**
 * Read-only on-chain transaction inspection for the AI's `explain_transaction`
 * tool.
 *
 * Given any 0x... EVM tx hash (66 chars: `0x` + 64 hex), returns a structured
 * summary the LLM can phrase in plain English. Resolution order:
 *
 *   a) Invalid hash (length ≠ 66 chars or non-hex) → status='invalid-hash'.
 *   b) `provider.getTransaction(hash)`:
 *      - throws   → status='rpc-failure' (we still echo the hash so the LLM
 *        can say "couldn't verify this tx right now")
 *      - returns `null` → status='not-found' (hash is well-formed but the
 *        chain has no record of it)
 *      - returns `TransactionResponse` → continue.
 *   c) Common fields: blockNumber, from, to, value, nonce, gas, data.
 *   d) Function-selector lookup from the first 4 bytes of `data` — converts
 *      `0xa9059cbb` → "ERC-20 transfer", `0x2e1a7d4d` → "WETH withdraw", etc.
 *   e) `kind` classification: og-transfer, erc20-transfer, erc20-approve,
 *      wrap, unwrap, uniswap-swap, contract-creation, unknown-call.
 *   f) Alias cross-ref for `to` (WOG/USDC/USDT/DEX router/factory).
 *   g) `provider.getTransactionReceipt(hash)` — derives `receipt.{status,
 *      gasUsed, logCount, confirmations}`. If the tx is mined but the receipt
 *      RPC hasn't caught up, status falls back to 'pending'.
 *
 * The tool NEVER sends funds. Output is NEVER a safety signal — Confirm is
 * still required for any send/swap.
 */

// ── Function selector map ────────────────────────────────────────────────
// Plain-English labels designed to slot into a 1-2 sentence explanation.
// Only the well-known infrastructure selectors live here — anything else
// falls back to the raw 0x selector and `kind: 'unknown-call'`.
const KNOWN_SELECTORS: Record<string, string> = {
  '0xa9059cbb': 'ERC-20 transfer',
  '0x23b872dd': 'ERC-20 transferFrom',
  '0x095ea7b3': 'ERC-20 approve',
  '0x2e1a7d4d': 'WETH withdraw (unwrap)',
  '0xd0e30db0': 'WETH deposit (wrap)',
  '0x7ff36ab5': 'Uniswap-V2 swapExactETHForTokens',
  '0x18cbafe5': 'Uniswap-V2 swapExactTokensForETH',
  '0x38ed1739': 'Uniswap-V2 swapExactTokensForTokens',
  '0xfb3bdb41': 'Uniswap-V2 swapETHForExactTokens',
  '0x5c11d795': 'Uniswap-V2 swapTokensForExactTokens',
};

// ── Alias cross-ref ──────────────────────────────────────────────────────
// Tiny mirror of `contractExplorer.knownContractLookup()` — keeps
// transactionExplorer self-contained without a circular import. Keys are
// lowercased addresses; values are alias + ContractKind tag.
interface KnownAlias {
  alias: string;
  kind: 'wrapped-native' | 'mock-stable' | 'dex-router' | 'dex-factory';
}

function aliasLookup(): Map<string, KnownAlias> {
  // config is a top-level import (see file header) — read lazily from it so
  // the module evaluates without any RPC until the AI actually calls
  // explainTransaction(). Cross-ref with src/og/contractExplorer.ts.
  const m = new Map<string, KnownAlias>();
  const add = (rawAddr: string, entry: KnownAlias): void => {
    if (/^0x[0-9a-fA-F]{40}$/.test(rawAddr)) m.set(rawAddr.toLowerCase(), entry);
  };
  add(config.WOG_ADDRESS,        { alias: 'WOG (wrapped native OG)', kind: 'wrapped-native' });
  add(config.USDC_ADDRESS,       { alias: 'USDC (mock)',              kind: 'mock-stable' });
  add(config.USDT_ADDRESS,       { alias: 'USDT (mock)',              kind: 'mock-stable' });
  add(config.DEX_ROUTER_ADDRESS, { alias: 'Uniswap-V2 router',        kind: 'dex-router' });
  add(config.DEX_FACTORY_ADDRESS,{ alias: 'Uniswap-V2 factory',       kind: 'dex-factory' });
  return m;
}

// ── Public surface ───────────────────────────────────────────────────────

export type TxKind =
  | 'og-transfer'       // native OG moved, no calldata
  | 'erc20-transfer'    // selector 0xa9059cbb or 0x23b872dd
  | 'erc20-approve'     // selector 0x095ea7b3
  | 'wrap'              // selector 0xd0e30db0 (WETH deposit)
  | 'unwrap'            // selector 0x2e1a7d4d (WETH withdraw)
  | 'uniswap-swap'      // any of the Uniswap-V2 swap* selectors
  | 'contract-creation' // `to === null`
  | 'unknown-call';     // data present, no recognised selector

export interface TxReceiptSummary {
  /** Success or reverted (1 vs 0 in receipt.status). */
  status: 'success' | 'reverted';
  /** gasUsed as decimal string (JSON-safe). */
  gasUsed: string;
  /** Number of event logs emitted by this tx. */
  logCount: number;
  /**
   * Confirmations from the RPC. May be null if the RPC didn't report it.
   * `currentBlock - txBlockNumber + 1` when populated.
   */
  confirmations: number | null;
}

export interface TxExplanation {
  hash: string;
  /** Whether the input matched the expected `0x` + 64 hex shape. */
  inputWasValid: boolean;
  /**
   * One of:
   *   - `'ok'` — tx (+ receipt, if mined) was found. `receipt.status === 'reverted'`
   *     possible inside that.
   *   - `'pending'` — tx is in the mempool OR was mined but no receipt yet.
   *   - `'invalid-hash'` — input shape rejected.
   *   - `'not-found'` — well-formed hash, chain has no record.
   *   - `'rpc-failure'` — getTransaction (or getTransactionReceipt on a
   *      mined tx) threw.
   */
  status: 'ok' | 'pending' | 'invalid-hash' | 'not-found' | 'rpc-failure';
  /** True iff the tx was located on chain. */
  found: boolean;
  blockNumber: number | null;
  from: string | null;
  /** Null when the tx is a contract creation (no destination). */
  to: string | null;
  /** Friendly alias for `to` if it matches a deployed bot contract. */
  toAlias: string | null;
  /** Kind tag for the alias (wrapped-native / mock-stable / dex-router / etc.). */
  toKind: 'wrapped-native' | 'mock-stable' | 'dex-router' | 'dex-factory' | null;
  /** Native-OG value moved, in wei — decimal string (JSON-safe). */
  valueWei: string | null;
  /** Same value formatted in OG ("1", "0.5", "0.0") via `formatEther`. */
  valueOG: string | null;
  nonce: number | null;
  /** Gas limit — decimal string for JSON safety. */
  gasLimit: string | null;
  /**
   * Effective gas price. For legacy 1-D-fee txs, `tx.gasPrice`. For EIP-1559
   * 2-D-fee txs, `tx.maxFeePerGas` (the cap the user paid). Decimal string.
   */
  gasPrice: string | null;
  /** True iff the tx carries EIP-1559 `maxFeePerGas` / `maxPriorityFeePerGas`. */
  hasEip1559: boolean;
  /** Raw calldata — '0x' for plain OG/value-only transfers. */
  data: string | null;
  /** Bytes after the `0x` prefix (`data.length === 0` for empty calldata). */
  dataSize: number;
  /** First 4 bytes of calldata (the function selector), or null. */
  functionSelector: string | null;
  /** Plain-English label if the selector is recognised. */
  functionName: string | null;
  /** Coarse classification of what this tx probably did. */
  kind: TxKind | null;
  /** True iff `to === null` — a contract-creation transaction. */
  isContractCreation: boolean;
  /** Receipt (only present once mined and the RPC has seen it). */
  receipt: TxReceiptSummary | null;
}

// ── Implementation ──────────────────────────────────────────────────────

const lower = (s: string): string => s.toLowerCase();

export async function explainTransaction(rawHash: string): Promise<TxExplanation> {
  const trimmed = String(rawHash ?? '').trim();

  // ---- (a) input shape ----------------------------------------------------
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return emptyResult(trimmed, /* inputWasValid */ false, /* status */ 'invalid-hash');
  }

  // ---- (b) tx lookup ------------------------------------------------------
  let tx: TransactionResponse | null;
  try {
    tx = await provider.getTransaction(trimmed);
  } catch {
    return emptyResult(trimmed, /* inputWasValid */ true, /* status */ 'rpc-failure');
  }
  if (tx === null) {
    return emptyResult(trimmed, /* inputWasValid */ true, /* status */ 'not-found');
  }

  // ---- (c) common fields --------------------------------------------------
  const blockNumber = typeof tx.blockNumber === 'number' ? tx.blockNumber : null;
  const from = tx.from ? lower(tx.from) : null;
  // tx.to is null for contract creation. Treat empty string defensively too.
  const to = tx.to ? lower(tx.to) : null;
  const valueWei = tx.value ?? 0n;
  const nonce = typeof tx.nonce === 'number' ? tx.nonce : null;
  // ethers v6: gasLimit on TransactionResponse. Fall back to legacy `gas`.
  const gasLimitBig = tx.gasLimit ?? (tx as unknown as { gas?: bigint }).gas ?? null;
  const hasEip1559 = tx.maxFeePerGas != null;
  const gasPriceBig = hasEip1559
    ? (tx.maxFeePerGas ?? null)
    : (tx.gasPrice ?? null);
  const data = tx.data ?? '0x';
  const dataSize = data === '0x' ? 0 : Math.floor((data.length - 2) / 2);

  // ---- (d) function selector + label -------------------------------------
  const functionSelector = data === '0x' ? null : data.slice(0, 10).toLowerCase();
  const functionName = functionSelector ? (KNOWN_SELECTORS[functionSelector] ?? null) : null;

  // ---- (e) kind classification -------------------------------------------
  const isContractCreation = to === null;
  let kind: TxKind | null = null;
  if (isContractCreation) {
    kind = 'contract-creation';
  } else if (data === '0x') {
    kind = 'og-transfer';
  } else if (functionSelector === '0xa9059cbb' || functionSelector === '0x23b872dd') {
    kind = 'erc20-transfer';
  } else if (functionSelector === '0x095ea7b3') {
    kind = 'erc20-approve';
  } else if (functionSelector === '0xd0e30db0') {
    kind = 'wrap';
  } else if (functionSelector === '0x2e1a7d4d') {
    kind = 'unwrap';
  } else if (functionSelector && functionName && functionName.startsWith('Uniswap')) {
    kind = 'uniswap-swap';
  } else if (functionSelector) {
    kind = 'unknown-call';
  }

  // ---- (f) alias cross-ref for `to` --------------------------------------
  let toAlias: string | null = null;
  let toKind: TxExplanation['toKind'] = null;
  if (to) {
    const known = aliasLookup().get(to);
    if (known) {
      toAlias = known.alias;
      toKind = known.kind;
    }
  }

  // ---- (g) receipt lookup (only meaningful if mined) ---------------------
  let receipt: TxReceiptSummary | null = null;
  let status: TxExplanation['status'] = 'ok';

  if (blockNumber === null) {
    // tx is in the mempool — no receipt to query.
    status = 'pending';
  } else {
    let r: TransactionReceipt | null = null;
    try {
      r = await provider.getTransactionReceipt(trimmed);
    } catch {
      r = null;
    }
    if (r === null) {
      // Mined but the receipt RPC hasn't caught up — treat as pending rather
      // than not-found so the LLM doesn't claim "tx not found" wrongly.
      status = 'pending';
    } else {
      const ok = typeof r.status === 'bigint' ? r.status === 1n : r.status === 1;
      const gasUsed = r.gasUsed ?? 0n;
      const confirmationsRaw = (r as unknown as { confirmations?: number | bigint }).confirmations;
      const confirmations: number | null =
        typeof confirmationsRaw === 'number'
          ? confirmationsRaw
          : (confirmationsRaw != null ? Number(confirmationsRaw) : null);
      receipt = {
        status: ok ? 'success' : 'reverted',
        gasUsed: gasUsed.toString(),
        logCount: Array.isArray(r.logs) ? r.logs.length : 0,
        confirmations,
      };
      status = 'ok';   // 'reverted' is captured inside receipt.status
    }
  }

  return {
    hash: trimmed,
    inputWasValid: true,
    status,
    found: true,
    blockNumber,
    from,
    to,
    toAlias,
    toKind,
    valueWei: valueWei.toString(),
    valueOG: formatOG(valueWei),
    nonce,
    gasLimit: gasLimitBig != null ? gasLimitBig.toString() : null,
    gasPrice: gasPriceBig != null ? gasPriceBig.toString() : null,
    hasEip1559,
    data,
    dataSize,
    functionSelector,
    functionName,
    kind,
    isContractCreation,
    receipt,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function emptyResult(
  hash: string,
  inputWasValid: boolean,
  status: TxExplanation['status'],
): TxExplanation {
  return {
    hash,
    inputWasValid,
    status,
    found: false,
    blockNumber: null,
    from: null,
    to: null,
    toAlias: null,
    toKind: null,
    valueWei: null,
    valueOG: null,
    nonce: null,
    gasLimit: null,
    gasPrice: null,
    hasEip1559: false,
    data: null,
    dataSize: 0,
    functionSelector: null,
    functionName: null,
    kind: null,
    isContractCreation: false,
    receipt: null,
  };
}
