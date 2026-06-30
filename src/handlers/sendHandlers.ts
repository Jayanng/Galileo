import type { Context } from 'grammy';
import { executeSend } from '../send/sendService';
import { pendingSends } from '../send/pendingSend';
import { sendState } from '../wallet/sendState';

const EXPLORER_TX = 'https://chainscan-galileo.0g.ai/tx/';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

/**
 * Confirm a staged send. We deliberately re-use the address already
 * captured in `pendingSends.toAddress` (resolved at stage time) instead
 * of re-resolving the username here — if the recipient's handle changed
 * between stage and confirm, the user's intent was to send to the
 * resolved address they approved, not to whatever the handle maps to
 * now. The actual on-chain call goes through `executeSend`.
 */
export async function handleSendConfirm(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Submitting…' });
  if (!userId) return;

  try {
    await ctx.editMessageReplyMarkup();
  } catch { /* ignore */ }

  const p = pendingSends.get(userId);
  if (!p) {
    await ctx.reply('No pending send. Use /send to start a new transfer.');
    return;
  }

  // Defensive guard — `prepareSend` validates with `isAddress`, so a
  // malformed toAddress should never appear in pendingSends. If it does
  // (corrupted map, manual edit, race), refuse to execute rather than
  // send funds to an unverified recipient.
  if (!/^0x[0-9a-fA-F]{40}$/i.test(p.toAddress)) {
    pendingSends.clear(userId);
    sendState.clear(userId);
    await ctx.reply('❌ Send failed: malformed pending recipient.');
    return;
  }

  const res = await executeSend(userId);
  if (!res.ok) {
    await ctx.reply(`❌ Send failed: ${res.error}`);
    return;
  }

  const header =
    p.recipientKind === 'username' && p.resolvedUsername
      ? `✅ *Sent to @${p.resolvedUsername}*`
      : '✅ *Sent!*';
  await ctx.reply(
    [header, '', res.summary, '', `Tx: [${res.hash.slice(0, 12)}…](${EXPLORER_TX}${res.hash})`].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleSendCancel(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  if (!userId) return;
  // No re-resolution — Cancel discards whatever was staged.
  pendingSends.clear(userId);
  sendState.clear(userId);
  try {
    await ctx.editMessageReplyMarkup();
  } catch { /* ignore */ }
  await ctx.reply('Cancelled.');
}
