import { parseEther, formatEther, isAddress } from 'ethers';
import { config } from '../config';
import { getSigner, listWallets, type WalletInfo } from '../wallet/walletService';
import { getActiveId } from '../wallet/activeWallet';
import { getBalance } from '../og/chain';
import { wrap, unwrap, wogConfigured } from '../og/wog';
import {
  dexConfigured,
  quoteOut,
  swapExactNativeForTokens,
  swapExactTokensForNative,
  swapExactTokensForTokens,
} from '../og/dex';
import { tokenBalance, tokenMeta, ensureAllowance } from '../og/erc20';
import { recordTx } from '../ai/memory';
import { pendingSwaps, type PendingSwap } from './pendingSwap';

export interface SwapRequest {
  from: string; // 'OG' | 'WOG' | 0x token address
  to: string;
  amount: string; // human decimal string of the INPUT token
  walletId?: string;
}

export type PrepareResult = { ok: true; summary: string } | { ok: false; error: string };
export type ExecuteResult = { ok: true; hash: string; summary: string } | { ok: false; error: string };

const NATIVE_NAMES = new Set(['OG', '0G', 'A0GI', 'NATIVE', 'ETH']);
const isNative = (t: string): boolean => NATIVE_NAMES.has(t.trim().toUpperCase());
const isWogToken = (t: string): boolean =>
  t.trim().toUpperCase() === 'WOG' ||
  (isAddress(t) && wogConfigured() && t.toLowerCase() === config.WOG_ADDRESS.toLowerCase());

/** Map a known token symbol to its configured contract address (null if unknown/unset). */
function symbolToAddress(sym: string): string | null {
  switch (sym.trim().toUpperCase()) {
    case 'USDC':
      return config.USDC_ADDRESS || null;
    case 'USDT':
      return config.USDT_ADDRESS || null;
    default:
      return null;
  }
}

/** Resolve a token symbol to its address; OG/WOG/0x inputs pass through untouched. */
function resolveTokenInput(t: string): string {
  return symbolToAddress(t) ?? t.trim();
}

/** Non-OG/WOG symbols that are swappable right now (a configured token + a live DEX). */
export function availableDexSymbols(): string[] {
  if (!dexConfigured()) return [];
  const out: string[] = [];
  if (config.USDC_ADDRESS) out.push('USDC');
  if (config.USDT_ADDRESS) out.push('USDT');
  return out;
}

async function resolveWallet(userId: string, walletId?: string): Promise<WalletInfo | null> {
  const wallets = await listWallets(userId);
  if (wallets.length === 0) return null;
  const id = walletId ?? (await getActiveId(userId)) ?? wallets[0]!.id;
  return wallets.find((w) => w.id === id) ?? wallets[0]!;
}

async function symOf(token: string): Promise<string> {
  try {
    return (await tokenMeta(token)).symbol;
  } catch {
    return 'tokens';
  }
}

/** Validate + quote a swap and stash it as the user's pending swap (no execution). */
export async function prepareSwap(userId: string, req: SwapRequest): Promise<PrepareResult> {
  const wallet = await resolveWallet(userId, req.walletId);
  if (!wallet) return { ok: false, error: 'You have no wallet yet — create one first.' };

  let amountWei: bigint;
  try {
    amountWei = parseEther(String(req.amount));
  } catch {
    return { ok: false, error: `Invalid amount "${req.amount}".` };
  }
  if (amountWei <= 0n) return { ok: false, error: 'Amount must be greater than 0.' };

  const from = resolveTokenInput(req.from);
  const to = resolveTokenInput(req.to);

  // OG -> WOG (wrap)
  if (isNative(from) && isWogToken(to)) {
    if (!wogConfigured()) return { ok: false, error: 'WOG is not configured yet (WOG_ADDRESS unset).' };
    const bal = await getBalance(wallet.address);
    if (bal < amountWei) return { ok: false, error: `Not enough OG in ${wallet.name} (have ${formatEther(bal)} OG).` };
    const summary = `Wrap *${req.amount} OG* → *${req.amount} WOG*\nWallet: *${wallet.name}*`;
    pendingSwaps.set(userId, {
      kind: 'wrap', walletId: wallet.id, walletName: wallet.name, fromSymbol: 'OG', toSymbol: 'WOG',
      amountWei: amountWei.toString(), amountInLabel: `${req.amount} OG`, estOutLabel: `${req.amount} WOG`, summary,
    });
    return { ok: true, summary };
  }

  // WOG -> OG (unwrap)
  if (isWogToken(from) && isNative(to)) {
    if (!wogConfigured()) return { ok: false, error: 'WOG is not configured yet (WOG_ADDRESS unset).' };
    const bal = await tokenBalance(config.WOG_ADDRESS, wallet.address);
    if (bal < amountWei) return { ok: false, error: `Not enough WOG in ${wallet.name} (have ${formatEther(bal)} WOG).` };
    const summary = `Unwrap *${req.amount} WOG* → *${req.amount} OG*\nWallet: *${wallet.name}*`;
    pendingSwaps.set(userId, {
      kind: 'unwrap', walletId: wallet.id, walletName: wallet.name, fromSymbol: 'WOG', toSymbol: 'OG',
      amountWei: amountWei.toString(), amountInLabel: `${req.amount} WOG`, estOutLabel: `${req.amount} OG`, summary,
    });
    return { ok: true, summary };
  }

  // token <-> token via DEX
  if (!dexConfigured()) {
    return {
      ok: false,
      error:
        'Token-to-token swaps need a DEX router, which is not configured on this network yet. ' +
        'You can wrap/unwrap OG↔WOG today.',
    };
  }
  return prepareDexSwap(userId, wallet, from, to, req.amount, amountWei);
}

async function prepareDexSwap(
  userId: string, wallet: WalletInfo, from: string, to: string, amountLabel: string, amountWei: bigint,
): Promise<PrepareResult> {
  const wog = config.WOG_ADDRESS;
  const fromIsNative = isNative(from);
  const toIsNative = isNative(to);
  const fromToken = fromIsNative || isWogToken(from) ? wog : from;
  const toToken = toIsNative || isWogToken(to) ? wog : to;

  if (!fromIsNative && !isAddress(fromToken)) {
    return { ok: false, error: `Unknown input token "${from}". Provide its 0x contract address.` };
  }
  if (!toIsNative && !isAddress(toToken)) {
    return { ok: false, error: `Unknown output token "${to}". Provide its 0x contract address.` };
  }

  const rawPath = fromIsNative ? [wog, toToken] : toIsNative ? [fromToken, wog] : [fromToken, wog, toToken];
  const path = rawPath.filter((a, i) => i === 0 || a.toLowerCase() !== rawPath[i - 1]!.toLowerCase());

  let estOut: bigint;
  try {
    estOut = await quoteOut(amountWei, path);
  } catch (e) {
    return { ok: false, error: `Could not quote this swap (no liquidity?): ${(e as Error).message}` };
  }
  const minOut = (estOut * BigInt(10000 - config.SWAP_SLIPPAGE_BPS)) / 10000n;

  const fromSym = fromIsNative ? 'OG' : await symOf(fromToken);
  const toSym = toIsNative ? 'OG' : await symOf(toToken);
  const routeKind = fromIsNative ? 'native-to-token' : toIsNative ? 'token-to-native' : 'token-to-token';

  const summary =
    `Swap *${amountLabel} ${fromSym}* → ~*${formatEther(estOut)} ${toSym}*\n` +
    `Min received: *${formatEther(minOut)} ${toSym}* (slippage ${config.SWAP_SLIPPAGE_BPS / 100}%)\n` +
    `Wallet: *${wallet.name}*`;

  pendingSwaps.set(userId, {
    kind: 'dex', walletId: wallet.id, walletName: wallet.name, fromSymbol: fromSym, toSymbol: toSym,
    amountWei: amountWei.toString(), amountInLabel: `${amountLabel} ${fromSym}`,
    estOutLabel: `~${formatEther(estOut)} ${toSym}`, summary, minOutWei: minOut.toString(), path, routeKind,
  });
  return { ok: true, summary };
}

/** Execute the user's pending swap, sign with their wallet, wait, and log it. */
export async function executeSwap(userId: string): Promise<ExecuteResult> {
  const p: PendingSwap | undefined = pendingSwaps.get(userId);
  if (!p) return { ok: false, error: 'No pending swap to confirm.' };

  const signer = await getSigner(userId, p.walletId);
  if (!signer) {
    pendingSwaps.clear(userId);
    return { ok: false, error: 'That wallet no longer exists.' };
  }

  const amountWei = BigInt(p.amountWei);
  try {
    let hash: string;
    if (p.kind === 'wrap') {
      const tx = await wrap(signer, amountWei);
      hash = (await tx.wait())?.hash ?? tx.hash;
    } else if (p.kind === 'unwrap') {
      const tx = await unwrap(signer, amountWei);
      hash = (await tx.wait())?.hash ?? tx.hash;
    } else {
      const minOut = BigInt(p.minOutWei ?? '0');
      const path = p.path ?? [];
      const to = await signer.getAddress();
      if (p.routeKind === 'native-to-token') {
        const tx = await swapExactNativeForTokens(signer, amountWei, minOut, path, to);
        hash = (await tx.wait())?.hash ?? tx.hash;
      } else if (p.routeKind === 'token-to-native') {
        await ensureAllowance(path[0]!, to, config.DEX_ROUTER_ADDRESS, amountWei, signer);
        const tx = await swapExactTokensForNative(signer, amountWei, minOut, path, to);
        hash = (await tx.wait())?.hash ?? tx.hash;
      } else {
        await ensureAllowance(path[0]!, to, config.DEX_ROUTER_ADDRESS, amountWei, signer);
        const tx = await swapExactTokensForTokens(signer, amountWei, minOut, path, to);
        hash = (await tx.wait())?.hash ?? tx.hash;
      }
    }
    pendingSwaps.clear(userId);
    recordTx(userId, { type: 'swap', amount: p.amountInLabel, from: p.fromSymbol, to: p.toSymbol, hash }).catch(() => {});
    return { ok: true, hash, summary: p.summary };
  } catch (e) {
    pendingSwaps.clear(userId);
    return { ok: false, error: (e as Error).message };
  }
}
