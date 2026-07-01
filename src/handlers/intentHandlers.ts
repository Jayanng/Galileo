import { InlineKeyboard, type Context } from 'grammy';
import { intentStore, summarize } from '../intents';

/**
 * Telegram command + inline-callback handlers for the Scheduled Intents Engine.
 *
 * Commands:
 *   /intents          List all DCA + alert intents with Cancel/Pause buttons.
 *   /cancel <id>      Cancel an intent by id (text command).
 *   /pause <id>       Pause an intent by id (text command).
 *
 * Inline callbacks:
 *   intent:cancel:<id>   Permanently remove an intent.
 *   intent:pause:<id>    Toggle pause/resume.
 */

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'active':
      return '✅ active';
    case 'paused':
      return '⏸ paused';
    case 'fired':
      return '✓ fired';
    default:
      return status;
  }
}

function typeIcon(type: 'dca' | 'alert'): string {
  return type === 'dca' ? '📈' : '🔔';
}

function renderIntentList(
  intents: { id: string; type: 'dca' | 'alert'; status: string; summary: string }[],
): { text: string; keyboard: InlineKeyboard } {
  const kb = new InlineKeyboard();
  if (intents.length === 0) {
    return {
      text: 'No scheduled intents yet.\n\nSay "dca 1 OG into USDC weekly" or "alert me if OG drops below $1" to create one.',
      keyboard: kb,
    };
  }
  const lines: string[] = ['📅 *Your scheduled intents*', ''];
  intents.forEach((i, idx) => {
    lines.push(`${idx + 1}. ${typeIcon(i.type)} ${i.summary}`);
    lines.push(`   _${statusBadge(i.status)}_ · id: \`${i.id}\``);
    lines.push('');
    kb.text('⏸/▶', `intent:pause:${i.id}`).text('🗑 Cancel', `intent:cancel:${i.id}`);
    if (idx < intents.length - 1) kb.row();
  });
  return { text: lines.join('\n').trimEnd(), keyboard: kb };
}

// ── /intents command ───────────────────────────────────────────────────

export async function handleIntentsCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const intents = await intentStore.listForUser(userId);
  const { text, keyboard } = renderIntentList(
    intents.map((i) => ({ id: i.id, type: i.type, status: i.status, summary: summarize(i) })),
  );
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

// ── /cancel <id> and /pause <id> text commands ─────────────────────────

export async function handleCancelCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const text = ctx.message?.text ?? '';
  const m = /^\/cancel\s+([0-9a-fA-F]+)\s*$/.exec(text);
  if (!userId) return;
  if (!m) {
    await ctx.reply('Usage: /cancel <intent-id> — get the id from /intents.');
    return;
  }
  const id = m[1]!;
  const existing = await intentStore.get(id);
  if (!existing || existing.userId !== userId) {
    await ctx.reply('Intent not found. Use /intents to see yours.');
    return;
  }
  await intentStore.remove(id);
  await ctx.reply(`🗑 Cancelled: ${summarize(existing)}`, { parse_mode: 'Markdown' });
}

export async function handlePauseCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const text = ctx.message?.text ?? '';
  const m = /^\/pause\s+([0-9a-fA-F]+)\s*$/.exec(text);
  if (!userId) return;
  if (!m) {
    await ctx.reply('Usage: /pause <intent-id> — get the id from /intents.');
    return;
  }
  const id = m[1]!;
  const existing = await intentStore.get(id);
  if (!existing || existing.userId !== userId) {
    await ctx.reply('Intent not found. Use /intents to see yours.');
    return;
  }
  const next = existing.status === 'paused' ? 'active' : 'paused';
  await intentStore.update(id, { status: next });
  const verb = next === 'paused' ? '⏸ Paused' : '▶ Resumed';
  await ctx.reply(`${verb}: ${summarize(existing)}`, { parse_mode: 'Markdown' });
}

// ── Inline-callback handlers ────────────────────────────────────────────

export async function handleIntentCallback(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const data = ctx.callbackQuery?.data ?? '';
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('intent:cancel:')) {
    const id = data.slice('intent:cancel:'.length);
    const existing = await intentStore.get(id);
    if (!existing || existing.userId !== userId) {
      await ctx.answerCallbackQuery({ text: 'Intent not found.' });
      return;
    }
    await intentStore.remove(id);
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    // Re-render the list (intent removed) so the message stays consistent.
    const remaining = await intentStore.listForUser(userId);
    const { text, keyboard } = renderIntentList(
      remaining.map((i) => ({ id: i.id, type: i.type, status: i.status, summary: summarize(i) })),
    );
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch {
      /* message may be too old to edit */
    }
    return;
  }

  if (data.startsWith('intent:pause:')) {
    const id = data.slice('intent:pause:'.length);
    const existing = await intentStore.get(id);
    if (!existing || existing.userId !== userId) {
      await ctx.answerCallbackQuery({ text: 'Intent not found.' });
      return;
    }
    const next = existing.status === 'paused' ? 'active' : 'paused';
    const updated = await intentStore.update(id, { status: next });
    if (!updated) {
      await ctx.answerCallbackQuery({ text: 'Could not update.' });
      return;
    }
    await ctx.answerCallbackQuery({ text: next === 'paused' ? 'Paused' : 'Resumed' });
    // Re-render the list so the status badge updates in place.
    const intents = await intentStore.listForUser(userId);
    const { text, keyboard } = renderIntentList(
      intents.map((i) => ({ id: i.id, type: i.type, status: i.status, summary: summarize(i) })),
    );
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
    } catch {
      /* message may be too old to edit */
    }
    return;
  }

  await ctx.answerCallbackQuery();
}
