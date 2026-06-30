/**
 * Portfolio aggregation: combines wallet balances with USD prices to produce
 * a per-wallet breakdown plus a grand total.
 *
 * Reuses `walletService.getAllBalances()` as the sole source of holdings.
 * Each balance (native OG wei) is converted to USD via `getPriceUSD`.
 *
 * Unknown tokens are listed without a USD value rather than crashing.
 * The portfolio computation never throws — all errors are caught per-wallet
 * and surfaced as `null` entries.
 */

import { getAllBalances, type WalletBalance } from '../wallet/walletService';
import { getPriceUSD } from './prices';
import { formatOG } from './chain';

// ── Types ──────────────────────────────────────────────────────────────

export interface PortfolioLine {
  walletName: string;
  walletAddress: string;
  symbol: string;
  /** Raw bigint balance in wei. */
  rawBalance: bigint;
  /** Formatted decimal (OG units). */
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

// ── Helpers ────────────────────────────────────────────────────────────

function formatUsd(value: number | null): string {
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
 *  1. Fetch all wallet balances via `walletService.getAllBalances()`.
 *  2. For each wallet, map the native OG balance → USD price.
 *  3. Sum all USD values into a grand total.
 *  4. Return structured data + pre-formatted strings.
 *
 * Errors are handled per-wallet — a single failed wallet does not crash
 * the whole portfolio. Unknown tokens appear with `—` price/value.
 */
export async function buildPortfolio(userId: string): Promise<PortfolioResult> {
  const lines: PortfolioLine[] = [];
  let grandTotal = 0;
  let hasPricedLine = false;

  let balances: WalletBalance[];
  try {
    balances = await getAllBalances(userId);
  } catch (e) {
    console.error('[portfolio] getAllBalances failed:', (e as Error).message);
    return {
      lines: [],
      grandTotalUsd: null,
      grandTotalFormatted: '—',
    };
  }

  // Fetch the OG price once and reuse it across all wallets.
  // getPriceUSD never throws — it returns null on failure.
  const ogUsd = await getPriceUSD('OG');

  for (const w of balances) {
    const quantity = formatOG(w.balance);
    const price = ogUsd;
    const value = price !== null && w.balance > 0n
      ? Number(quantity) * price
      : null;

    lines.push({
      walletName: w.name,
      walletAddress: w.address,
      symbol: 'OG',
      rawBalance: w.balance,
      quantity,
      usdPrice: price,
      usdValue: value,
    });

    if (value !== null) {
      grandTotal += value;
      hasPricedLine = true;
    }
  }

  return {
    lines,
    grandTotalUsd: hasPricedLine ? grandTotal : null,
    grandTotalFormatted: hasPricedLine ? formatUsd(grandTotal) : '—',
  };
}

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

  for (const line of result.lines) {
    const walletLabel = `*${line.walletName}*`;
    const shortAddr = `\`${line.walletAddress.slice(0, 8)}…${line.walletAddress.slice(-6)}\``;
    parts.push(`${walletLabel}  ${shortAddr}`);

    // Build table rows
    const rows: string[] = [tableHeader, tableSep];
    const qtyPad = line.quantity.padEnd(17).slice(0, 17);
    const priceStr = line.usdPrice !== null ? formatUsd(line.usdPrice).padEnd(13).slice(0, 13) : '—             ';
    const valueStr = line.usdValue !== null ? formatUsd(line.usdValue).padEnd(15).slice(0, 15) : '—               ';

    rows.push(`\`OG      ${qtyPad} ${priceStr} ${valueStr}\``);
    parts.push(rows.join('\n'));
    parts.push('');
  }

  // Grand total
  parts.push(`*Grand Total: ${result.grandTotalFormatted} USD*`);

  return parts.join('\n');
}
