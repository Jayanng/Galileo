import { InlineKeyboard, type Context } from 'grammy';
import { prepareSwap, availableDexSymbols } from '../swap/swapService';
import { swapState } from '../wallet/swapState';

/**
 * Deterministic swap UX — the reliable path to the Confirm button.
 *
 * The AI `swap` tool depends on the 7B model actually emitting a tool call,
 * which it does inconsistently (so the Confirm button was intermittent). These
 * handlers stage a swap directly from a dashboard tap or a command, with zero
 * reliance on the model, so Confirm always renders. They reuse prepareSwap /
 * pendingSwaps / handleSwapConfirm from the existing swap pipeline.
 */

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

/** Confirm/Cancel keyboard shown under a staged swap. Shared with aiHandler. */
export function swapConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('✅ Confirm swap', 'swap:confirm').text('✖ Cancel', 'swap:cancel');
}

/** Validate + stage a swap, then render the Confirm button (or an honest error). */
export async function stageSwap(
  ctx: Context,
  userId: string,
  draft: { from: string; to: string; amount: string },
): Promise<void> {
  const res = await prepareSwap(userId, { from: draft.from, to: draft.to, amount: draft.amount });
  if (!res.ok) {
    await ctx.reply(`⚠️ ${res.error}`);
    return;
  }
  await ctx.reply(res.summary, { parse_mode: 'Markdown', reply_markup: swapConfirmKeyboard() });
}

// ── Dashboard "Swap" menu ────────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  OG_WOG: '🔁 Wrap OG → WOG',
  WOG_OG: '🔁 Unwrap WOG → OG',
  OG_USDC: '💵 OG → USDC',
  USDC_OG: '💵 USDC → OG',
  OG_USDT: '💵 OG → USDT',
  USDT_OG: '💵 USDT → OG',
};

const ROUTE_RE = /^swr:([A-Z]+)_([A-Z]+)$/;

/** Build the swap-direction keyboard, showing token rows only when a DEX is live. */
function buildSwapMenuKeyboard(): { keyboard: InlineKeyboard; note: string } {
  const kb = new InlineKeyboard()
    .text(ROUTE_LABELS.OG_WOG, 'swr:OG_WOG')
    .row()
    .text(ROUTE_LABELS.WOG_OG, 'swr:WOG_OG')
    .row();

  const dexSyms = availableDexSymbols();
  if (dexSyms.includes('USDC')) {
    kb.text(ROUTE_LABELS.OG_USDC, 'swr:OG_USDC').text(ROUTE_LABELS.USDC_OG, 'swr:USDC_OG').row();
  }
  if (dexSyms.includes('USDT')) {
    kb.text(ROUTE_LABELS.OG_USDT, 'swr:OG_USDT').text(ROUTE_LABELS.USDT_OG, 'swr:USDT_OG').row();
  }
  kb.text('⬅️ Back', 'home:back');

  const note =
    dexSyms.length === 0
      ? '\n\n_Token swaps (USDC/USDT) aren’t live yet — only wrap/unwrap is available._'
      : '';
  return { keyboard: kb, note };
}

/** `home:swap` — open the swap-direction menu in place. */
export async function handleSwapMenu(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const { keyboard, note } = buildSwapMenuKeyboard();
  const text = '🔄 *Swap* — pick a direction:' + note;
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/** `swr:<FROM>_<TO>` — a direction was tapped; ask for the amount next. */
export async function handleSwapNew(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const m = ctx.callbackQuery?.data?.match(ROUTE_RE);
  await ctx.answerCallbackQuery();
  if (!userId || !m) return;
  const from = m[1]!;
  const to = m[2]!;
  swapState.set(userId, { from, to, fromLabel: from, toLabel: to });
  await ctx.reply(`How much *${from}* do you want to convert to *${to}*?\nSend an amount, e.g. \`0.1\`.`, {
    parse_mode: 'Markdown',
  });
}

/** Consumes the awaited amount (set by the menu or a bare command) and stages the swap. */
export async function handleSwapAmountReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  const draft = userId ? swapState.get(userId) : undefined;
  if (!userId || !draft) return;
  swapState.clear(userId);
  const m = text.match(/(\d*\.?\d+)/);
  if (!m) {
    await ctx.reply('That doesn’t look like an amount. Tap 🔄 Swap again and send just a number, e.g. 0.1.');
    return;
  }
  await stageSwap(ctx, userId, { from: draft.from, to: draft.to, amount: m[1]! });
}

// ── Commands: /wrap, /unwrap, /swap ──────────────────────────────────────────

async function runDirection(ctx: Context, from: string, to: string, verb: string): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const amount = String(ctx.match ?? '').trim().split(/\s+/)[0] ?? '';
  if (!amount) {
    swapState.set(userId, { from, to, fromLabel: from, toLabel: to });
    await ctx.reply(`How much *${from}* to ${verb}? Send an amount, e.g. \`0.1\`.`, { parse_mode: 'Markdown' });
    return;
  }
  await stageSwap(ctx, userId, { from, to, amount });
}

export async function handleWrapCommand(ctx: Context): Promise<void> {
  await runDirection(ctx, 'OG', 'WOG', 'wrap');
}

export async function handleUnwrapCommand(ctx: Context): Promise<void> {
  await runDirection(ctx, 'WOG', 'OG', 'unwrap');
}

/** `/swap <amount> <FROM> <TO>`; with no args, opens the direction menu. */
export async function handleSwapCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const parts = String(ctx.match ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    await stageSwap(ctx, userId, {
      amount: parts[0]!,
      from: parts[1]!.toUpperCase(),
      to: parts[2]!.toUpperCase(),
    });
    return;
  }
  const { keyboard, note } = buildSwapMenuKeyboard();
  await ctx.reply('🔄 *Swap* — pick a direction:' + note, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── Natural-language matcher (pre-AI) ────────────────────────────────────────

/**
 * Parse the common swap phrasings into a concrete route, deterministically.
 * Conservative on purpose: only clear "wrap/unwrap/swap <amount> …" forms match;
 * anything fuzzy falls through to the AI agent.
 */
export function parseSwapText(text: string): { from: string; to: string; amount: string } | null {
  const t = text.trim().toLowerCase();

  let m = t.match(/^(wrap|unwrap)\s+([\d.]+)(?:\s+(?:og|wog))?$/);
  if (m) {
    const amount = m[2]!;
    return m[1] === 'wrap' ? { from: 'OG', to: 'WOG', amount } : { from: 'WOG', to: 'OG', amount };
  }

  m = t.match(/^swap\s+([\d.]+)\s+([a-z]+)\s+(?:to|for|into|->)\s+([a-z]+)$/);
  if (m) {
    return { amount: m[1]!, from: m[2]!.toUpperCase(), to: m[3]!.toUpperCase() };
  }
  return null;
}
