/**
 * Read-only on-chain contract inspection for the AI's `explain_contract` tool.
 *
 * Given any 0x address, returns a structured summary that the LLM can phrase
 * in plain English. Three things we look up, in order, each as insensitive as
 * the network will allow:
 *
 *   1. Is this one of our deployed contracts? (known-alias table, no RPC)
 *   2. Is this address a contract at all, or just an EOA wallet? (getCode)
 *   3. If it's a contract, can we read ERC-20 metadata? (name/symbol/decimals)
 *
 * Everything is read-only. The tool never suggests sending funds and the
 * output is never trusted as a safety signal — callers must still Confirm
 * before any on-chain move.
 */

import { isAddress } from 'ethers';
import { provider } from './chain';
import { config } from '../config';
import { erc20 } from './erc20';

// ── Known alias table ──────────────────────────────────────────────────
// Map of deployed contract address → human label + kind. Built lazily from
// config so it picks up whatever env the bot is running with. Keys are
// lowercased for case-insensitive lookup.

export type ContractKind =
  | 'wrapped-native'
  | 'mock-stable'
  | 'dex-router'
  | 'dex-factory'
  | 'unknown-contract';

interface KnownContract {
  alias: string;
  kind: ContractKind;
  notes: string;
}

function knownContractLookup(): Map<string, KnownContract> {
  const m = new Map<string, KnownContract>();
  const addIfValid = (addr: string, entry: KnownContract) => {
    if (/^0x[0-9a-fA-F]{40}$/.test(addr)) m.set(addr.toLowerCase(), entry);
  };
  addIfValid(config.WOG_ADDRESS, {
    alias: 'WOG (wrapped native OG)',
    kind: 'wrapped-native',
    notes: 'WETH9-style — used to wrap native OG into a token for DEX trading.',
  });
  addIfValid(config.USDC_ADDRESS, {
    alias: 'USDC (mock)',
    kind: 'mock-stable',
    notes: 'Demo USDC token used in the Galileo DEX for testing swaps.',
  });
  addIfValid(config.USDT_ADDRESS, {
    alias: 'USDT (mock)',
    kind: 'mock-stable',
    notes: 'Demo USDT token used in the Galileo DEX for testing swaps.',
  });
  addIfValid(config.DEX_ROUTER_ADDRESS, {
    alias: 'Uniswap-V2 router',
    kind: 'dex-router',
    notes: 'Routes swaps — quotes output amounts and executes token trades.',
  });
  addIfValid(config.DEX_FACTORY_ADDRESS, {
    alias: 'Uniswap-V2 factory',
    kind: 'dex-factory',
    notes: 'Creates and tracks the liquidity pairs in the DEX.',
  });
  return m;
}

// ── ERC-20 metadata read ───────────────────────────────────────────────

/**
 * Best-effort ERC-20 metadata read. Each individual call is wrapped with
 * `.catch(() => null)` so a single revert can't poison Promise.all. Resolves
 * with the values found, or null if every read failed (likely a non-ERC-20
 * contract). Partial reads are surfaced (empty string / 0 default) so the
 * LLM can see what DID come back.
 */
async function tryReadErc20(address: string): Promise<{
  name: string;
  symbol: string;
  decimals: number;
} | null> {
  const c = erc20(address); // reuses the existing ERC20_ABI (provider-backed).
  const [name, symbol, decimals] = await Promise.all([
    (c.name() as Promise<string>).catch(() => null),
    (c.symbol() as Promise<string>).catch(() => null),
    (c.decimals() as Promise<bigint>).catch(() => null),
  ]);
  // If every read failed/reverted, the contract almost certainly doesn't
  // speak ERC-20 metadata. Don't pretend it did.
  if (name === null && symbol === null && decimals === null) return null;
  return {
    name: name != null ? String(name) : '',
    symbol: symbol != null ? String(symbol) : '',
    decimals: decimals != null ? Number(decimals) : 0,
  };
}

// ── EOA detection ──────────────────────────────────────────────────────

/**
 * Resolve whether `address` has any on-chain bytecode. EOAs return '0x';
 * contracts return non-empty bytecode ('0x...' of length > 2).
 *
 * Returns `null` if the RPC failed — we want the LLM to say "I'm not sure"
 * over a false "no contract there".
 */
async function hasCode(address: string): Promise<boolean | null> {
  try {
    const code = await provider.getCode(address);
    return code !== '0x' && code.length > 2;
  } catch {
    return null;
  }
}

// ── Public surface ─────────────────────────────────────────────────────

export interface Erc20Meta {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ContractExplanation {
  address: string;
  /**
   * `true` if on-chain bytecode exists (it's a contract).
   * `false` if the address is an EOA wallet (no bytecode).
   * `null` if the RPC failed — the LLM should say "I'm not sure".
   */
  isContract: boolean | null;
  /** Friendly alias if this address matches one of our deployed contracts. */
  knownAlias: string | null;
  /** Kind tag for the alias (wrapped-native / mock-stable / dex-router / etc.). */
  knownKind: ContractKind | null;
  /** A 1-line context blurb for the alias; useful for explaining role. */
  notes: string | null;
  /** ERC-20 metadata, or null if the contract isn't / doesn't look like an ERC-20. */
  erc20: Erc20Meta | null;
  /** Whether the input was a syntactically valid 0G/EVM address at all. */
  inputWasValid: boolean;
  /** One of "ok" | "invalid-address" | "rpc-failure" — for assertion/logs. */
  status: 'ok' | 'invalid-address' | 'rpc-failure';
}

/**
 * Read what we can about `rawAddress` from the chain. Read-only and
 * best-effort: every RPC call is individually protected so a single failure
 * (e.g. provider rate-limit) doesn't take down the whole response.
 *
 * Resolution order:
 *   a) Invalid address → short-circuit to status='invalid-address'.
 *   b) Local alias check (no RPC) → recorded regardless of chain results.
 *   c) getCode → EOA vs contract vs RPC-failure.
 *   d) If contract: try ERC-20 metadata reads.
 */
export async function explainContract(rawAddress: string): Promise<ContractExplanation> {
  const trimmed = String(rawAddress ?? '').trim();
  if (!isAddress(trimmed)) {
    return {
      address: trimmed,
      isContract: false,
      knownAlias: null,
      knownKind: null,
      notes: null,
      erc20: null,
      inputWasValid: false,
      status: 'invalid-address',
    };
  }

  const lower = trimmed.toLowerCase();
  const known = knownContractLookup().get(lower) ?? null;

  const codeResult = await hasCode(trimmed);
  // RPC failure: still return what we know, mark isContract as null.
  if (codeResult === null) {
    return {
      address: trimmed,
      isContract: null,
      knownAlias: known?.alias ?? null,
      knownKind: known?.kind ?? null,
      notes: known?.notes ?? null,
      erc20: null,
      inputWasValid: true,
      status: 'rpc-failure',
    };
  }

  const erc20Meta = codeResult ? await tryReadErc20(trimmed) : null;
  // knownKind: explicit 'unknown-contract' when the address IS a contract but
  // not in our alias table — distinguishes "couldn't reach the chain" (null)
  // from "we got chain data and it's just not our deployment" (a real kind).
  const knownKind = known?.kind ?? (codeResult ? 'unknown-contract' : null);

  return {
    address: trimmed,
    isContract: codeResult,
    knownAlias: known?.alias ?? null,
    knownKind,
    notes: known?.notes ?? null,
    erc20: erc20Meta,
    inputWasValid: true,
    status: 'ok',
  };
}
