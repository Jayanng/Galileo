/**
 * Portfolio aggregation: combines wallet balances with USD prices to produce
 * a per-wallet breakdown plus a grand total.
 *
 * Uses `walletService.getWalletAssets()` to fetch all token balances (native OG
 * plus configured tokens WOG, USDC, USDT). Each balance is converted to USD
 * via `getPriceUSD`.
 *
 * Unknown tokens are listed without a USD value rather than crashing.
 * The portfolio computation never throws — all errors are caught per-wallet
 * and surfaced as `null` entries.
 */

import { walletStore } from '../wallet/walletStore';
import { getWalletAssets, type AssetBalance } from '../wallet/walletService';
import { getPriceUSD } from './prices';
import { formatOG } from './chain';

// ── Types ──────────────────────────────────────────────────────────────

export interface PortfolioLine {
  walletName: string;
  walletAddress: string;
  symbol: string;
  /** Raw bigint balance in wei. */
  rawBalance: bigint;
  /** Formatted decimal (token units). */
  quantity: string;
  /** USD price per token. null when unknown. */
  usdPrice: number | null;
  /** quantity × usdPrice. null when usdPrice is null. */
  usdValue: number | null;
}

export interface PortfolioResult {
  /** Per-wallet, per-token breakdown. */
  lines: PortfolioLine[];
  /** Sum of all usdValue entries. null when nothing has a price. */
  grandTotalUsd: number | null;
  /** Human-readable grand total (e.g. "$1.23"). Empty when grandTotalUsd is null. */
  grandTotalFormatted: string;
}

/**
 * A single point-in-time snapshot of a user's portfolio value.
 * Used by the /history command for P&L tracking.
 */
export interface PortfolioSnapshot {
  /** ISO date string (YYYY-MM-DD) when this snapshot was taken. */
  date: string;
  /** Total portfolio value in USD at snapshot time. */
  totalUsd: number;
  /** Per-token breakdown at snapshot time. */
  assets: Array<{ symbol: string; quantity: string; usdValue: number }>;
  /** Unix-ms timestamp when the snapshot was recorded. */
  ts: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Format a USD number for display. */
export function formatUsd(value: number | null): string {
  if (value === null) return '—';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 1_000) return `$${value.toFixed(2)}`;
  if (value < 1_000_000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Main ───────────────────────────────────────────────────────────────

/**
 * Build a portfolio breakdown for a given user.
 *
 * Steps:
 *  1. List all wallets for the user.
 *  2. For each wallet, fetch ALL token balances via `getWalletAssets()`.
 *  3. For each token, fetch USD price and compute USD value.
 *  4. Sum all USD values into a grand total.
 *  5. Return structured data + pre-formatted strings.
 *
 * Errors are handled per-wallet — a single failed wallet does not crash
 * the whole portfolio. Unknown tokens appear with `—` price/value.
 */
export async function buildPortfolio(userId: string): Promise<PortfolioResult> {
  const lines: PortfolioLine[] = [];
  let grandTotal = 0;
  let hasPricedLine = false;

  // 1. List wallets
  let wallets: Array<{ id: string; name: string; address: string }>;
  try {
    wallets = (await walletStore.list(userId)).map((w) => ({
      id: w.id,
      name: w.name,
      address: w.address,
    }));
  } catch (e) {
    console.error('[portfolio] walletStore.list failed:', (e as Error).message);
    return { lines: [], grandTotalUsd: null, grandTotalFormatted: '—' };
  }

  // 2-3. For each wallet, fetch all asset balances + prices
  for (const wallet of wallets) {
    let assets: AssetBalance[];
    try {
      assets = await getWalletAssets(wallet.address);
    } catch (e) {
      console.warn(`[portfolio] getWalletAssets failed for ${wallet.address}: ${(e as Error).message}`);
      continue;
    }

    for (const asset of assets) {
      const quantity = formatOG(asset.balance);

      // Fetch price for this symbol (getPriceUSD never throws)
      let price: number | null = null;
      try {
        price = await getPriceUSD(asset.symbol);
      } catch {
        price = null;
      }

      const value = price !== null && asset.balance > 0n ? Number(quantity) * price : null;

      lines.push({
        walletName: wallet.name,
        walletAddress: wallet.address,
        symbol: asset.symbol,
        rawBalance: asset.balance,
        quantity,
        usdPrice: price,
        usdValue: value,
      });

      if (value !== null) {
        grandTotal += value;
        hasPricedLine = true;
      }
    }
  }

  return {
    lines,
    grandTotalUsd: hasPricedLine ? grandTotal : null,
    grandTotalFormatted: hasPricedLine ? formatUsd(grandTotal) : '—',
  };
}

// ── Rendering ──────────────────────────────────────────────────────────

/**
 * Render a portfolio result as a Markdown string suitable for Telegram.
 *
 * Renders:
 *  - Per-wallet table: token | qty | $price | $value
 *  - Grand total row at the bottom
 */
export function renderPortfolioMarkdown(result: PortfolioResult): string {
  if (result.lines.length === 0) {
    return ['💰 *Portfolio*', '', "You don't have any wallets yet. Create one by saying *\"create me a wallet\"*."].join('\n');
  }

  const parts: string[] = ['💰 *Portfolio*', ''];
  const tableHeader = '`Token   Qty               Price         Value`';
  const tableSep = '`─────── ───────────────── ───────────── ───────────────`';

  // Group lines by wallet
  const byWallet = new Map<string, PortfolioLine[]>();
  for (const line of result.lines) {
    const key = line.walletName;
    if (!byWallet.has(key)) byWallet.set(key, []);
    byWallet.get(key)!.push(line);
  }

  for (const [walletName, tokenLines] of byWallet) {
    const first = tokenLines[0]!;
    const shortAddr = `\`${first.walletAddress.slice(0, 8)}…${first.walletAddress.slice(-6)}\``;
    parts.push(`*${walletName}*  ${shortAddr}`);

    const rows: string[] = [tableHeader, tableSep];
    for (const line of tokenLines) {
      const qtyPad = line.quantity.padEnd(17).slice(0, 17);
      const symPad = line.symbol.padEnd(7).slice(0, 7);
      const priceStr = line.usdPrice !== null ? formatUsd(line.usdPrice).padEnd(13).slice(0, 13) : '—             ';
      const valueStr = line.usdValue !== null ? formatUsd(line.usdValue).padEnd(15).slice(0, 15) : '—               ';
      rows.push(`\`${symPad} ${qtyPad} ${priceStr} ${valueStr}\``);
    }
    parts.push(rows.join('\n'));
    parts.push('');
  }

  // Grand total
  parts.push(`*Grand Total: ${result.grandTotalFormatted} USD*`);

  return parts.join('\n');
}
