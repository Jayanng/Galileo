/**
 * Telegram command handlers for portfolio and price lookups.
 *
 * Commands:
 *   /portfolio — Show all wallets with USD prices plus grand total.
 *   /price <symbol-or-id> — Quick USD price lookup for any crypto.
 */

import type { Context } from 'grammy';
import { buildPortfolio, renderPortfolioMarkdown } from '../og/portfolio';
import { getPriceUSD, getPriceByCoinGeckoId, KNOWN_SYMBOLS } from '../og/prices';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

/**
 * Format a USD number nicely.
 * Shows 6 decimals for sub-cent values, 2 decimals otherwise.
 */
function formatUsd(value: number): string {
  if (value < 0.000001) return `$${value.toExponential(2)}`;
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 1_000_000) return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── /portfolio ─────────────────────────────────────────────────────────

/**
 * /portfolio — Show a Markdown table of all wallet balances in USD.
 *
 * Flow:
 *  1. Call buildPortfolio (which calls getAllBalances + getPriceUSD).
 *  2. Render the result as Markdown.
 *  3. Reply with the rendered table.
 */
export async function handlePortfolio(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  // Send a typing indicator while we compute
  await ctx.replyWithChatAction('typing');

  try {
    const portfolio = await buildPortfolio(userId);
    const markdown = renderPortfolioMarkdown(portfolio);
    await ctx.reply(markdown, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[portfolio] unexpected error:', (e as Error).message);
    await ctx.reply(
      '⚠️ Something went wrong building your portfolio. Please try again in a moment.',
    );
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

  // Parse the argument after /price
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

  // 1. Try as known symbol
  try {
    const usd = await getPriceUSD(input);
    if (usd !== null) {
      await ctx.reply(
        `📊 *${input}* → ${formatUsd(usd)} USD`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
  } catch {
    // Fall through to CoinGecko ID lookup
  }

  // 2. Try as raw CoinGecko ID
  try {
    const rawId = args.trim().toLowerCase();
    const usd = await getPriceByCoinGeckoId(rawId);
    if (usd !== null) {
      const display = rawId.length > 20 ? `${rawId.slice(0, 12)}…${rawId.slice(-6)}` : rawId;
      await ctx.reply(
        `📊 *${display}* → ${formatUsd(usd)} USD`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
  } catch {
    // Fall through to error
  }

  // 3. Not found
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
