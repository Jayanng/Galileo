/**
 * Telegram command handlers for portfolio and price lookups.
 *
 * Commands:
 *   /portfolio — Show all wallets with USD prices plus grand total.
 *   /price <symbol-or-id> — Quick USD price lookup for any crypto.
 *   /history [day|week|month] — Portfolio P&L over time from daily snapshots.
 */

import type { Context } from 'grammy';
import { buildPortfolio, renderPortfolioMarkdown, formatUsd, type PortfolioSnapshot } from '../og/portfolio';
import { getPriceUSD, getPriceByCoinGeckoId, KNOWN_SYMBOLS } from '../og/prices';
import { recordSnapshot, getSnapshots } from '../analytics/snapshot';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

// ── /portfolio ─────────────────────────────────────────────────────────

/**
 * /portfolio — Show a Markdown table of all wallet balances in USD.
 *
 * Flow:
 *  1. Call buildPortfolio (which fetches all token balances + USD prices).
 *  2. Render the result as Markdown.
 *  3. Reply with the rendered table.
 *
 * Also triggers a daily snapshot for P&L tracking (idempotent — only the
 * first call each day records a new snapshot; subsequent calls update it).
 */
export async function handlePortfolio(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    const portfolio = await buildPortfolio(userId);
    const markdown = renderPortfolioMarkdown(portfolio);

    // Fire-and-forget daily snapshot for /history
    if (portfolio.grandTotalUsd !== null) {
      const assets = portfolio.lines
        .filter((l) => l.usdValue !== null)
        .map((l) => ({
          symbol: l.symbol,
          quantity: l.quantity,
          usdValue: l.usdValue!,
        }));
      recordSnapshot(userId, portfolio.grandTotalUsd, assets).catch(() => {});
    }

    await ctx.reply(markdown, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[portfolio] unexpected error:', (e as Error).message);
    await ctx.reply('⚠️ Something went wrong building your portfolio. Please try again in a moment.');
  }
}

// ── /price ─────────────────────────────────────────────────────────────

/**
 * /price <symbol-or-id> — Quick USD lookup.
 *
 * Resolution order:
 *  1. Try as a known symbol (OG, WOG, USDC, USDT → getPriceUSD).
 *  2. Try as a raw CoinGecko ID (getPriceByCoinGeckoId).
 *  3. If nothing found, show an error with known symbols.
 */
export async function handlePrice(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;
  if (!text) return;

  const args = text.trim().slice('/price'.length).trim();
  if (!args) {
    await ctx.reply(
      [
        '📊 *Usage:* `/price <symbol>`',
        '',
        `Known symbols: ${KNOWN_SYMBOLS.join(', ')}`,
        '',
        'You can also use any CoinGecko ID (e.g. `/price bitcoin`, `/price ethereum`).',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  await ctx.replyWithChatAction('typing');

  const input = args.toUpperCase().trim();

  try {
    const usd = await getPriceUSD(input);
    if (usd !== null) {
      await ctx.reply(`📊 *${input}* → ${formatUsd(usd)} USD`, { parse_mode: 'Markdown' });
      return;
    }
  } catch {
    // fall through
  }

  try {
    const rawId = args.trim().toLowerCase();
    const usd = await getPriceByCoinGeckoId(rawId);
    if (usd !== null) {
      const display = rawId.length > 20 ? `${rawId.slice(0, 12)}…${rawId.slice(-6)}` : rawId;
      await ctx.reply(`📊 *${display}* → ${formatUsd(usd)} USD`, { parse_mode: 'Markdown' });
      return;
    }
  } catch {
    // fall through
  }

  const knownList = KNOWN_SYMBOLS.join(', ');
  await ctx.reply(
    [
      `❌ Could not find a price for *${input}*.`,
      '',
      `Known symbols: ${knownList}`,
      '',
      'You can also use any CoinGecko ID (e.g. `bitcoin`, `ethereum`).',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

// ── /history ───────────────────────────────────────────────────────────

type HistoryPeriod = 'day' | 'week' | 'month';

function parsePeriod(input: string): HistoryPeriod {
  const lower = input.toLowerCase().trim();
  if (lower === 'day' || lower === 'd') return 'day';
  if (lower === 'week' || lower === 'w') return 'week';
  if (lower === 'month' || lower === 'm') return 'month';
  return 'week'; // default
}

function periodMs(period: HistoryPeriod): number {
  const now = Date.now();
  switch (period) {
    case 'day':   return now - 24 * 60 * 60 * 1000;
    case 'week':  return now - 7 * 24 * 60 * 60 * 1000;
    case 'month': return now - 30 * 24 * 60 * 60 * 1000;
  }
}

/**
 * Build a human-readable label for a date relative to today.
 * If within the current month, shows "Mon DD". Otherwise "Mon DD, YYYY".
 */
function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (!sameYear) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * /history [day|week|month] — Show portfolio P&L over time.
 *
 * Reads daily snapshots recorded by /portfolio and renders a markdown
 * table with date, total USD, and % change from the first snapshot in
 * the range (baseline).
 *
 * Examples:
 *   /history week   — last 7 days
 *   /history        — defaults to week
 *   /history month  — last 30 days
 */
export async function handleHistory(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  const msgText = ctx.message && 'text' in ctx.message ? ctx.message.text ?? '' : '';
  const arg = msgText.trim().slice('/history'.length).trim();
  const period: HistoryPeriod = arg ? parsePeriod(arg) : 'week';

  await ctx.replyWithChatAction('typing');

  // Build a fresh snapshot first so the current value is included
  try {
    const portfolio = await buildPortfolio(userId);
    if (portfolio.grandTotalUsd !== null) {
      const assets = portfolio.lines
        .filter((l) => l.usdValue !== null)
        .map((l) => ({ symbol: l.symbol, quantity: l.quantity, usdValue: l.usdValue! }));
      await recordSnapshot(userId, portfolio.grandTotalUsd, assets);
    }
  } catch {
    // best-effort
  }

  const snapshots = await getSnapshots(userId, periodMs(period));

  if (snapshots.length === 0) {
    await ctx.reply(
      [
        '📈 *Portfolio History*',
        '',
        'No snapshots yet. Run `/portfolio` first to start tracking.',
        '',
        '_Snapshots are recorded daily when you check /portfolio._',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Most recent first — baseline is the OLDEST in range
  const sorted = [...snapshots].sort((a, b) => b.ts - a.ts);
  const baseline = sorted[sorted.length - 1]!;

  const periodLabel = period === 'day' ? '24 hours' : period === 'week' ? '7 days' : '30 days';

  const parts: string[] = [`📈 *Portfolio History — ${periodLabel}*`, ''];

  // Table: Date | Total | Change
  parts.push('`Date              Total USD      Change `');
  parts.push('`───────────────── ─────────────── ───────`');

  for (const snap of sorted) {
    const label = dateLabel(snap.date).padEnd(17).slice(0, 17);
    const total = formatUsd(snap.totalUsd).padEnd(15).slice(0, 15);
    const change = snap.totalUsd - baseline.totalUsd;
    const changePct = baseline.totalUsd > 0 ? (change / baseline.totalUsd) * 100 : 0;
    const changeStr = formatPct(changePct).padStart(7);
    const arrow = change >= 0 ? '🟢' : '🔴';
    parts.push(`\`${label} ${total} ${changeStr}\`  ${arrow}`);
  }

  parts.push('');

  // P&L summary
  const current = sorted[0]!;
  const totalChange = current.totalUsd - baseline.totalUsd;
  const totalPct = baseline.totalUsd > 0 ? (totalChange / baseline.totalUsd) * 100 : 0;
  const direction = totalChange >= 0 ? '📈' : '📉';

  parts.push(
    `*P&L Summary*`,
    '',
    `Baseline (${dateLabel(baseline.date)}): ${formatUsd(baseline.totalUsd)} USD`,
    `Current:                       ${formatUsd(current.totalUsd)} USD`,
    `${direction} *${formatPct(totalPct)}* (${formatUsd(totalChange)} USD)`,
  );

  await ctx.reply(parts.join('\n'), { parse_mode: 'Markdown' });
}
