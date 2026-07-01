/**
 * Execution engine for the Scheduled Intents Engine.
 *
 * - DCA:    synthesize a PendingSwap from the intent, hand it to the existing
 *           swapService.executeSwap (which signs with the user's decrypted key
 *           via getSigner), then notify the user via Telegram.
 * - Alert:  fetch the current USD price (or hardcoded $1 for stablecoins) and
 *           compare against the intent's threshold + operator. Fire if met.
 *
 * The executor NEVER throws on a per-intent failure; it always returns an
 * updated intent record so the worker can persist the new state.
 */
import { parseEther, formatEther, isAddress } from 'ethers';
import { config } from '../config';
import {
  computeNextRun,
  type AlertIntent,
  type DcaIntent,
  type Intent,
} from './types';
import { getPriceUSD, getPriceByCoinGeckoId, SYMBOL_TO_COINGECKO_ID } from '../og/prices';
import { executeSwap } from '../swap/swapService';
import { pendingSwaps, type PendingSwap } from '../swap/pendingSwap';
import { getWallet } from '../wallet/walletService';
import { recordTx } from '../ai/memory';

/** Minimal bot surface used here — keeps tests free of grammY. */
export interface TelegramBot {
  api: {
    sendMessage(chatId: number | string, text: string, opts?: Record<string, unknown>): Promise<unknown>;
  };
}

/** Result of executing one intent. Always returns the updated intent. */
export interface ExecuteResult {
  intent: Intent;
}

/** Stablecoins are priced at $1 by getPriceUSD's hardcoded map. */
const STABLECOINS = new Set(['USDC', 'USDT']);

/** DCA paths the worker knows how to execute end-to-end via swapService. */
const SUPPORTED_DCA_PATHS: ReadonlyArray<readonly ['OG' | 'WOG' | 'USDC' | 'USDT', 'OG' | 'WOG' | 'USDC' | 'USDT']> = [
  ['OG', 'USDC'],
  ['OG', 'USDT'],
  ['OG', 'WOG'],
  ['WOG', 'OG'],
];

export function isSupportedDcaPath(from: string, to: string): boolean {
  return SUPPORTED_DCA_PATHS.some((p) => p[0] === from && p[1] === to);
}

/** True when an alert's condition is met by `price` against `threshold` + `operator`. */
export function evaluateAlertCondition(
  price: number,
  operator: '<' | '>' | '<=' | '>=',
  threshold: number,
): boolean {
  switch (operator) {
    case '<':
      return price < threshold;
    case '>':
      return price > threshold;
    case '<=':
      return price <= threshold;
    case '>=':
      return price >= threshold;
  }
}

/**
 * Build the PendingSwap the worker needs to feed to swapService.executeSwap.
 * Pure function: takes plain inputs, returns a PendingSwap (or null for wrap/unwrap
 * which use the dedicated paths).
 */
export function buildDcaPendingSwap(
  intent: DcaIntent,
  walletName: string,
): PendingSwap | { kind: 'wrap' | 'unwrap'; err: string } | null {
  const from = intent.fromToken;
  const to = intent.toToken;
  const amountWei = parseEther(intent.amount);
  const amountLabel = `${intent.amount} ${from}`;

  if (from === 'OG' && to === 'WOG') {
    return {
      kind: 'wrap',
      walletId: intent.walletId,
      walletName,
      fromSymbol: 'OG',
      toSymbol: 'WOG',
      amountWei: amountWei.toString(),
      amountInLabel: amountLabel,
      estOutLabel: `${intent.amount} WOG`,
      summary: `Wrap ${amountLabel} → ${intent.amount} WOG (DCA from ${intent.schedule.raw})`,
    };
  }
  if (from === 'WOG' && to === 'OG') {
    return {
      kind: 'unwrap',
      walletId: intent.walletId,
      walletName,
      fromSymbol: 'WOG',
      toSymbol: 'OG',
      amountWei: amountWei.toString(),
      amountInLabel: amountLabel,
      estOutLabel: `${intent.amount} OG`,
      summary: `Unwrap ${amountLabel} → ${intent.amount} OG (DCA from ${intent.schedule.raw})`,
    };
  }

  const wog = config.WOG_ADDRESS;
  const usdc = config.USDC_ADDRESS;
  const usdt = config.USDT_ADDRESS;
  if (!wog || !isAddress(wog)) return { kind: 'wrap', err: 'WOG not configured (WOG_ADDRESS unset).' };

  if (from === 'OG' && (to === 'USDC' || to === 'USDT')) {
    const tokenAddr = to === 'USDC' ? usdc : usdt;
    if (!tokenAddr || !isAddress(tokenAddr)) return { kind: 'wrap', err: `${to} not configured (${to}_ADDRESS unset).` };
    return {
      kind: 'dex',
      walletId: intent.walletId,
      walletName,
      fromSymbol: 'OG',
      toSymbol: to,
      amountWei: amountWei.toString(),
      amountInLabel: amountLabel,
      estOutLabel: `~? ${to}`,
      summary: `Swap ${amountLabel} → ${to} via DEX (DCA from ${intent.schedule.raw})`,
      minOutWei: '0',
      path: [wog, tokenAddr],
      routeKind: 'native-to-token',
    };
  }

  return null;
}

/** Fetch the current USD price for an alert intent, with stablecoin shortcut. */
async function fetchAlertPrice(alert: AlertIntent): Promise<number | null> {
  if (STABLECOINS.has(alert.symbol)) return 1;
  // Prefer the stored coingeckoId for direct lookup; fall back to symbol.
  if (alert.coingeckoId && alert.coingeckoId !== 'stablecoin') {
    const price = await getPriceByCoinGeckoId(alert.coingeckoId);
    if (price !== null) return price;
  }
  if (SYMBOL_TO_COINGECKO_ID[alert.symbol]) {
    return getPriceUSD(alert.symbol);
  }
  return null;
}

function priceFmt(n: number): string {
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Execute one intent. For DCA this can take ~30s (sign + wait for tx).
 * For alerts it's a single price read.
 *
 * Never throws; on failure the returned intent keeps status='active' so the
 * next tick retries.
 */
export async function executeIntent(intent: Intent, bot: TelegramBot): Promise<ExecuteResult> {
  if (intent.type === 'dca') return executeDca(intent, bot);
  return executeAlert(intent, bot);
}

async function executeDca(intent: DcaIntent, bot: TelegramBot): Promise<ExecuteResult> {
  const now = Date.now();
  const wallet = await getWallet(intent.userId, intent.walletId);
  if (!wallet) {
    await bot.api.sendMessage(
      intent.userId,
      `⚠️ DCA paused: wallet "${intent.walletId}" no longer exists. Use /intents to cancel.`,
    );
    return { intent: { ...intent, status: 'paused' } };
  }

  const built = buildDcaPendingSwap(intent, wallet.name);
  if (built === null) {
    await bot.api.sendMessage(
      intent.userId,
      `⚠️ DCA failed: path ${intent.fromToken}→${intent.toToken} is not supported by the worker.`,
    );
    return { intent: { ...intent, nextRunAt: computeNextRun(intent.schedule, now + 60_000) } };
  }
  if ('err' in built) {
    await bot.api.sendMessage(intent.userId, `⚠️ DCA failed: ${built.err}`);
    return { intent: { ...intent, nextRunAt: computeNextRun(intent.schedule, now + 60_000) } };
  }

  pendingSwaps.set(intent.userId, built);
  const result = await executeSwap(intent.userId);

  if (!result.ok) {
    await bot.api.sendMessage(
      intent.userId,
      `⚠️ DCA failed (${intent.schedule.raw}): ${result.error}\nNext attempt in ${intent.schedule.raw}.`,
    );
    return {
      intent: {
        ...intent,
        nextRunAt: computeNextRun(intent.schedule, now),
        lastExecutedAt: intent.lastExecutedAt,
      },
    };
  }

  // Success — log on-chain tx + notify user.
  recordTx(intent.userId, {
    type: 'swap',
    amount: `${intent.amount} ${intent.fromToken}→${intent.toToken}`,
    from: intent.fromToken,
    to: intent.toToken,
    hash: result.hash,
  }).catch(() => {});
  await bot.api.sendMessage(
    intent.userId,
    `✅ DCA fired (${intent.schedule.raw}): ${result.summary}\nNext attempt in ${intent.schedule.raw}.`,
  );
  return {
    intent: {
      ...intent,
      nextRunAt: computeNextRun(intent.schedule, now),
      lastExecutedAt: now,
    },
  };
}

async function executeAlert(alert: AlertIntent, bot: TelegramBot): Promise<ExecuteResult> {
  const now = Date.now();
  const price = await fetchAlertPrice(alert);
  if (price === null) {
    // Couldn't price this symbol right now; try again next tick.
    return { intent: { ...alert, lastCheckedAt: now } };
  }
  const fired = evaluateAlertCondition(price, alert.operator, alert.threshold);
  if (fired) {
    await bot.api.sendMessage(
      alert.userId,
      `🔔 Alert fired: ${alert.symbol} is now ${priceFmt(price)} (${alert.operator} $${alert.threshold})`,
    );
    return { intent: { ...alert, status: 'fired', firedAt: now, lastCheckedAt: now } };
  }
  return { intent: { ...alert, lastCheckedAt: now } };
}
