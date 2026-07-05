import type { Context } from 'grammy';
import { executeSwap } from '../swap/swapService';
import { pendingSwaps } from '../swap/pendingSwap';
import { cancelReceipt } from '../receipts';

const EXPLORER_TX = 'https://chainscan-galileo.0g.ai/tx/';
const PROOF_VERIFY_URL = 'https://galileo-test.fly.dev/verify/';

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
  const txLine = `Tx: [${res.hash.slice(0, 12)}…](${EXPLORER_TX}${res.hash})`;
  const receiptLine =
    res.receiptId && res.receiptRootHash
      ? `🧾 Receipt: [0x${res.receiptRootHash.slice(2, 12)}…](${PROOF_VERIFY_URL}${res.receiptRootHash})`
      : res.receiptId
        ? `🧾 Receipt: \`/receipt\` (upload pending)`
        : '';
  await ctx.reply(
    ['✅ *Swap complete*', '', res.summary, '', txLine, receiptLine].filter(Boolean).join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleSwapCancel(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  if (!userId) return;
  // F5: mark any staged receipt as cancelled before clearing the pending swap.
  const p = pendingSwaps.get(userId);
  if (p?.receiptId) cancelReceipt(p.receiptId).catch(() => {});
  pendingSwaps.clear(userId);
  try {
    await ctx.editMessageReplyMarkup();
  } catch {
    /* ignore */
  }
  await ctx.reply('Swap cancelled.');
}
