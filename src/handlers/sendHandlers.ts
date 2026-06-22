import type { Context } from 'grammy';
import { executeSend } from '../send/sendService';
import { pendingSends } from '../send/pendingSend';
import { sendState } from '../wallet/sendState';

const EXPLORER_TX = 'https://chainscan-galileo.0g.ai/tx/';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

export async function handleSendConfirm(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Submitting…' });
  if (!userId) return;

  try {
    await ctx.editMessageReplyMarkup();
  } catch { /* ignore */ }

  const res = await executeSend(userId);
  if (!res.ok) {
    await ctx.reply(`❌ Send failed: ${res.error}`);
    return;
  }
  await ctx.reply(
    ['✅ *Sent!*', '', res.summary, '', `Tx: [${res.hash.slice(0, 12)}…](${EXPLORER_TX}${res.hash})`].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleSendCancel(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  if (!userId) return;
  pendingSends.clear(userId);
  sendState.clear(userId);
  try {
    await ctx.editMessageReplyMarkup();
  } catch { /* ignore */ }
  await ctx.reply('Cancelled.');
}
