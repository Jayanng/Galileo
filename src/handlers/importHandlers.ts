/**
 * All Telegram-side logic for the /import feature. Kept in one file so the
 * flow is readable end-to-end without bouncing between modules.
 *
 *   /import                 → prompt: "send me your private key"
 *   /import <key>           → inline validation → preview w/ Confirm
 *   next plain message      → if staged: validate as key → preview w/ Confirm
 *   import:confirm button   → importWallet() → success message, delete the
 *                             user's key-bearing message (best-effort)
 *   import:cancel button    → discard state, no wallet created
 *
 * Private keys are NEVER exposed to the LLM (no import_wallet AI tool). The
 * flow is strictly command + button driven, so the key never lands in
 * conversation history or 0G Storage memory snapshots.
 */

import { InlineKeyboard, type Context } from 'grammy';
import { importState, inspectPrivateKey, importWallet } from '../wallet/import';
import { recordToolCall } from '../ai/memory';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

/** Inline keyboard for the import-preview message. */
function previewKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Confirm import', 'import:confirm')
    .text('❌ Cancel', 'import:cancel');
}

// ── Inline-button entry ────────────────────────────────────────────────

/**
 * Triggered by the home-dashboard “⬇️ Import wallet” button. Acknowledges the
 * tap and feeds back into the same flow as `/import` (no args) — stages the
 * user and sends the prompt. The interceptor (1d in bot.ts) then accepts the
 * next plain message as the private key.
 *
 * If a stage or preview is already open for this user, do nothing extra: the
 * existing prompt stays on screen and they can still finish it. Spamming the
 * button shouldn't pile up duplicate prompts.
 */
export async function handleImportButton(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery) return;
  // Ack the click first so the Telegram UI never visibly hangs, regardless
  // of any subsequent guard.
  await ctx.answerCallbackQuery();
  const userId = userIdOf(ctx);
  if (!userId || importState.isActive(userId)) return;
  await handleImportCommand(ctx);
}

// ── Command entry ──────────────────────────────────────────────────────

/**
 * `/import` command entry. Two forms supported:
 *   - `/import`         — staged mode: bot replies asking for the key.
 *   - `/import <key>`   — inline mode: validate immediately, show preview.
 *
 * grammY's `bot.command('import', …)` calls back with the raw ctx — we extract
 * the post-command text from `ctx.message.text` ourselves (it may include
 * `@botname` after the command and any amount of whitespace).
 */
export async function handleImportCommand(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  const raw = ctx.message?.text ?? '';
  // Strip the `/import` command (allow `/import@botname` suffix in groups).
  // Capture everything after the command as the candidate key — private keys
  // are hex with no spaces, so any token past this point is part of the key.
  const m = raw.match(/^\/import(?:@\w+)?\s+(.+)$/s);
  const keyArg = m?.[1]?.trim();
  if (keyArg) {
    await stagePreview(ctx, userId, keyArg);
    return;
  }
  importState.stage(userId);
  await ctx.reply(
    [
      '🔐 *Import a wallet*',
      '',
      'Send me the *private key* of the wallet you want to import.',
      '',
      '• Format: 64 hex characters, with or without the `0x` prefix.',
      '• Example: `0x1234abcd…` or just `1234abcd…`',
      '',
      "I'll derive the address and show you a preview before anything is saved.",
      // Security note: Telegram bots cannot guarantee message deletion in
      // group chats, but we delete in 1:1 chats best-effort below. Advise
      // the user regardless.
      '⚠️ *For your safety:* please delete the message containing your key after sending it. ' +
        'I will also try to delete it automatically.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

// ── Interceptor target ─────────────────────────────────────────────────

/**
 * Called by the interceptor in bot.ts when a staged user sends their next
 * plain message. Validates as a private key and either shows the preview
 * or rejects with a clear error.
 */
export async function handleImportKeyReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) return;
  await stagePreview(ctx, userId, text);
}

// ── Confirm / Cancel callbacks ─────────────────────────────────────────

export async function handleImportConfirm(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }
  const preview = importState.getPreview(userId);
  importState.clear(userId);
  // Acknowledge the button tap immediately so the UI doesn't hang.
  if (!preview) {
    await ctx.answerCallbackQuery({ text: 'Import expired — try again.' });
    try {
      await ctx.editMessageText('⏰ That import expired. Send /import to start again.');
    } catch {
      /* message not editable */
    }
    return;
  }

  const result = await importWallet(userId, preview.privateKey, preview.address);
  if (!result.ok) {
    await ctx.answerCallbackQuery({ text: 'Import failed' });
    await ctx.reply(`❌ ${result.error}`);
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Wallet imported' });
  const w = result.wallet;
  await ctx.reply(
    [
      '✅ *Wallet imported*',
      '',
      `Name: *${w.name}*`,
      `Address: \`${w.address}\``,
      '',
      '• Use `/rename` to set a custom name.',
      '• Use `/wallet` to switch to this wallet and view QR / balance.',
      '',
      '_Reminder: please delete any message you sent containing the private key._',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
  // Record the import in the user's permanent memory so the AI can recall it
  // later (e.g., "when did I import this wallet?"). `recordToolCall` is
  // documented as fire-and-forget — never throws.
  await recordToolCall(
    userId,
    'import_wallet',
    { address: w.address, name: w.name },
    { imported: true, id: w.id, name: w.name, address: w.address },
  );
}

export async function handleImportCancel(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.answerCallbackQuery();
    return;
  }
  importState.clear(userId);
  await ctx.answerCallbackQuery({ text: 'Cancelled' });
  try {
    await ctx.editMessageText('🚫 Import cancelled. Send /import to try again.');
  } catch {
    await ctx.reply('🚫 Import cancelled. Send /import to try again.');
  }
}

// ── Shared "build the preview message" logic ───────────────────────────

async function stagePreview(ctx: Context, userId: string, rawKey: string): Promise<void> {
  const insp = inspectPrivateKey(rawKey);
  if (!insp.ok) {
    importState.clear(userId);
    await ctx.reply(`❌ ${insp.error}\n\nSend /import to try again.`);
    return;
  }
  importState.setPreview(userId, { privateKey: insp.privateKey, address: insp.address });
  // Best-effort: delete the user's key-bearing message. Works in private chats;
  // silently no-ops in groups where the bot lacks permission.
  try {
    await ctx.deleteMessage();
  } catch {
    /* ignore — we'll repeat the warning in the reply */
  }
  await ctx.reply(
    [
      '👀 *Import preview*',
      '',
      `Address: \`${insp.address}\``,
      '',
      'Default name: "Imported N" — you can rename with `/rename` after confirming.',
      '',
      'Tap *Confirm* to save this wallet, or *Cancel* to discard.',
      '',
      '⚠️ _Please delete any other message you sent containing the private key._',
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: previewKeyboard() },
  );
}
