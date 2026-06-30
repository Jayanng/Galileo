import { InlineKeyboard, type Context } from 'grammy';
import { isAddress } from 'ethers';
import { prepareSend } from '../send/sendService';
import { sendState } from '../wallet/sendState';
import { resolveRecipientToAddress, type ResolvedRecipient } from '../wallet/recipientResolver';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

export function sendConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('✅ Confirm send', 'send:confirm').text('✖ Cancel', 'send:cancel');
}

const HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;

function extractHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

/**
 * Resolve a raw recipient string via `resolveRecipientToAddress`, route the
 * user-friendly error reply, and clear `sendState` on failure. On success,
 * return the typed resolution for the caller to act on.
 */
async function resolveAndReply(
  ctx: Context,
  userId: string,
  rawInput: string,
): Promise<{ ok: true; result: ResolvedRecipient } | { ok: false }> {
  const res = await resolveRecipientToAddress(rawInput, userId);
  if ('error' in res) {
    const handle = extractHandle(rawInput);
    if (res.error === 'not_found') {
      const msg = handle
        ? `I can't find @${handle} \u2014 ask them to message me once so I can link their wallet.`
        : `I couldn't understand that recipient.`;
      sendState.clear(userId);
      await ctx.reply(msg);
      return { ok: false };
    }
    // no_wallets
    const msg = handle
      ? `@${handle} has no wallet yet \u2014 ask them to create one and try again.`
      : `That recipient has no wallet yet.`;
    sendState.clear(userId);
    await ctx.reply(msg);
    return { ok: false };
  }
  return { ok: true, result: res };
}

/** Validate + stage a send, then render the Confirm button (or an honest error). */
export async function stageSend(
  ctx: Context,
  userId: string,
  draft: {
    to: string;
    amount: string;
    recipientKind?: 'address' | 'username';
    resolvedUsername?: string;
  },
): Promise<void> {
  const resolved = await resolveAndReply(ctx, userId, draft.to);
  if (!resolved.ok) return;
  const r = resolved.result;
  // Only accept successfully-resolved kinds here.
  if (r.error) return;
  if (r.kind !== 'address' && r.kind !== 'username') return;

  const res = await prepareSend(userId, {
    to: r.address,
    amount: draft.amount,
    recipientKind: r.kind,
    resolvedUsername: r.kind === 'username' ? r.username : undefined,
  });
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

/** Consumes an address/handle reply, then asks for amount. */
export async function handleSendAddressReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const resolved = await resolveAndReply(ctx, userId, text.trim());
  if (!resolved.ok) return;
  const r = resolved.result;
  if (r.error) return;

  if (r.kind === 'username') {
    sendState.set(userId, {
      stage: 'amount',
      to: '@' + r.username,
      recipientKind: 'username',
      resolvedUsername: r.username,
    });
    await ctx.reply(
      `How much OG to send to\n\`@${r.username}\`?\n\nSend an amount, e.g. \`0.1\`.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // r.kind === 'address'
  sendState.set(userId, { stage: 'amount', to: r.address, recipientKind: 'address' });
  await ctx.reply(`How much OG to send to\n\`${r.address}\`?\n\nSend an amount, e.g. \`0.1\`.`, {
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
  await stageSend(ctx, userId, {
    to: draft.to,
    amount: m[1]!,
    recipientKind: draft.recipientKind,
    resolvedUsername: draft.resolvedUsername,
  });
}

/** `/send [recipient] [amount]` or `/send [amount] [recipient]` (recipient = 0x... or @handle) */
export async function handleSendCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const parts = String(ctx.match ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const [a, b] = parts;

    // 0x address in either slot.
    if (isAddress(a!)) {
      await stageSend(ctx, userId, { to: a!, amount: b!, recipientKind: 'address' });
      return;
    }
    if (isAddress(b!)) {
      await stageSend(ctx, userId, { to: b!, amount: a!, recipientKind: 'address' });
      return;
    }

    // Telegram @handle in either slot. Stage the raw handle; stageSend
    // calls resolveRecipientToAddress and routes not_found / no_wallets
    // through resolveAndReply (same path as parseSendText).
    const handleA = extractHandle(a!);
    if (handleA) {
      await stageSend(ctx, userId, { to: '@' + handleA, amount: b! });
      return;
    }
    const handleB = extractHandle(b!);
    if (handleB) {
      await stageSend(ctx, userId, { to: '@' + handleB, amount: a! });
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
 * Accepts either an EVM address (0x + 40 hex) or a Telegram-style @username
 * (5-32 chars: A-Z, a-z, 0-9, underscore) as the recipient.
 * Examples:
 *   "send 0.1 OG to 0xADDR"
 *   "send 0.1 to 0xADDR"
 *   "send 0xADDR 0.1"
 *   "send 0.1 OG to @alice"
 *   "send @alice 0.1"
 */
export function parseSendText(text: string): { to: string; amount: string } | null {
  let m = text.match(/^send\s+([\d.]+)\s*(?:og)?\s+to\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\b/i);
  if (m) return { amount: m[1]!, to: m[2]! };

  m = text.match(/^send\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\s+([\d.]+)(?:\s+og)?$/i);
  if (m) return { to: m[1]!, amount: m[2]! };

  return null;
}
