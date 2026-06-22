import { InlineKeyboard, type Context } from 'grammy';
import { isAddress } from 'ethers';
import { prepareSend } from '../send/sendService';
import { sendState } from '../wallet/sendState';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

export function sendConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('✅ Confirm send', 'send:confirm').text('✖ Cancel', 'send:cancel');
}

/** Validate + stage a send, then render the Confirm button (or an honest error). */
export async function stageSend(
  ctx: Context,
  userId: string,
  draft: { to: string; amount: string },
): Promise<void> {
  const res = await prepareSend(userId, { to: draft.to, amount: draft.amount });
  if (!res.ok) {
    await ctx.reply(`⚠️ ${res.error}`);
    return;
  }
  await ctx.reply(res.summary, { parse_mode: 'Markdown', reply_markup: sendConfirmKeyboard() });
}

/** `home:send` — dashboard Send button: ask for recipient address. */
export async function handleSendButton(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  sendState.set(userId, { stage: 'address' });
  await ctx.reply('📤 *Send OG*\n\nEnter the recipient address (or /start to cancel):', {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('✖ Cancel', 'send:cancel'),
  });
}

/** Consumes an address reply, then asks for amount. */
export async function handleSendAddressReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const addr = text.trim();
  if (!isAddress(addr)) {
    await ctx.reply(
      'That doesn\'t look like a valid address (needs to start with 0x and be 42 characters). Try again or /start to cancel.',
    );
    return;
  }
  sendState.set(userId, { stage: 'amount', to: addr });
  await ctx.reply(`How much OG to send to\n\`${addr}\`?\n\nSend an amount, e.g. \`0.1\`.`, {
    parse_mode: 'Markdown',
  });
}

/** Consumes the awaited amount and stages the send. */
export async function handleSendAmountReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  const draft = userId ? sendState.get(userId) : undefined;
  if (!userId || !draft || draft.stage !== 'amount' || !draft.to) return;
  sendState.clear(userId);
  const m = text.match(/(\d*\.?\d+)/);
  if (!m) {
    await ctx.reply('That doesn\'t look like an amount. Send just a number, e.g. 0.1.');
    return;
  }
  await stageSend(ctx, userId, { to: draft.to, amount: m[1]! });
}

/** `/send [address] [amount]` or `/send [amount] [address]` */
export async function handleSendCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const parts = String(ctx.match ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const [a, b] = parts;
    if (isAddress(a!)) {
      await stageSend(ctx, userId, { to: a!, amount: b! });
      return;
    }
    if (isAddress(b!)) {
      await stageSend(ctx, userId, { to: b!, amount: a! });
      return;
    }
  }

  sendState.set(userId, { stage: 'address' });
  await ctx.reply('📤 *Send OG*\n\nEnter the recipient address (or /start to cancel):', {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('✖ Cancel', 'send:cancel'),
  });
}

/**
 * Parse natural-language send phrases deterministically.
 * "send 0.1 OG to 0xADDR" / "send 0.1 to 0xADDR" / "send 0xADDR 0.1"
 */
export function parseSendText(text: string): { to: string; amount: string } | null {
  let m = text.match(/^send\s+([\d.]+)\s*(?:og)?\s+to\s+(0x[0-9a-fA-F]{40})\b/i);
  if (m) return { amount: m[1]!, to: m[2]! };

  m = text.match(/^send\s+(0x[0-9a-fA-F]{40})\s+([\d.]+)(?:\s+og)?$/i);
  if (m) return { to: m[1]!, amount: m[2]! };

  return null;
}
