import type { Context } from 'grammy';
import { executeSwap } from '../swap/swapService';
import { pendingSwaps } from '../swap/pendingSwap';

const EXPLORER_TX = 'https://chainscan-galileo.0g.ai/tx/';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

export async function handleSwapConfirm(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Submitting…' });
  if (!userId) return;

  // Drop the Confirm/Cancel buttons to prevent a double-submit while it runs.
  try {
    await ctx.editMessageReplyMarkup();
  } catch {
    /* message gone or unchanged — ignore */
  }

  const res = await executeSwap(userId);
  if (!res.ok) {
    await ctx.reply(`❌ Swap failed: ${res.error}`);
    return;
  }
  await ctx.reply(
    ['✅ *Swap complete*', '', res.summary, '', `Tx: [${res.hash.slice(0, 12)}…](${EXPLORER_TX}${res.hash})`].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleSwapCancel(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  if (!userId) return;
  pendingSwaps.clear(userId);
  try {
    await ctx.editMessageReplyMarkup();
  } catch {
    /* ignore */
  }
  await ctx.reply('Swap cancelled.');
}
