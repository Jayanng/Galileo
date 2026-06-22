import { InlineKeyboard, type Context } from 'grammy';
import { runAgent } from '../ai/agent';
import { recordMessage, getRecent, search } from '../ai/memory';
import { actionKeyboard } from './walletHandlers';
import type { ChatMessage } from '../og/compute';
import type { StoredMessage, StoredToolCall, StoredTx, SearchEntry } from '../ai/memory';

/**
 * F1: Infinite Wallet Memory via 0G Storage KV.
 *
 * Every user message and assistant reply is persisted to 0G Storage via
 * recordMessage(). On each turn, recent history is fetched from 0G Storage
 * via getRecent() and passed as LLM context.
 *
 * Because memory lives on 0G Storage (not in process memory), it survives
 * bot restarts. The AI agent can also use the search_history tool to
 * retrieve arbitrary past interactions.
 *
 * We keep a small in-memory cache of the last N messages (MAX_CACHED)
 * so we don't need to hit 0G Storage on EVERY turn. On bot restart, the
 * cache is empty but memory is still intact on 0G Storage.
 */

const MAX_CACHED = 20;
const histories = new Map<string, ChatMessage[]>();

function getHistory(userId: string): ChatMessage[] {
  return histories.get(userId) ?? [];
}

function setHistory(userId: string, history: ChatMessage[]): void {
  const trimmed = history.slice(-MAX_CACHED);
  histories.set(userId, trimmed);
}

/**
 * Detect the bot's own "I don't have any record" style replies.
 *
 * These replies are toxic context for the 7B model: when it sees a
 * `user: "what did I do today?" → assistant: "I don't have any record"`
 * pattern in either the injected memoryContext OR the conversation
 * history, it mimics the pattern and repeats "no record" even when the
 * correct answer is right in front of it. We strip them everywhere we
 * build LLM context.
 *
 * Normalizes curly/typographic apostrophes (U+2018–U+201B) to ASCII '
 * before matching — the LLM emits curly apostrophes.
 */
function isNoRecordReply(content: string): boolean {
  const c = (content || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  return (
    c.includes("don't have any record") ||
    c.includes('any record') ||
    c.includes("don't have any activities") ||
    c.includes("isn't any information") ||
    c.includes("don't have any information") ||
    c.includes('no record')
  );
}

/**
 * Convert a StoredMessage from 0G Storage to the ChatMessage format
 * expected by the LLM agent.
 */
function storedToChat(m: StoredMessage): ChatMessage {
  return { role: m.role as 'user' | 'assistant', content: m.content };
}

/**
 * Merge in-memory cached history with 0G Storage history.
 *
 * On first message after a bot restart, the in-memory cache is empty but
 * 0G Storage has all past messages. We fetch recent history from 0G Storage
 * and use that as context.
 *
 * On subsequent messages, the in-memory cache is kept up-to-date and
 * preferred for performance (no storage reads needed).
 *
 * "No record" assistant replies are filtered out of the history we return —
 * leaving them in causes the 7B model to mimic the pattern (see isNoRecordReply).
 */
async function loadHistory(userId: string): Promise<ChatMessage[]> {
  const cached = getHistory(userId);
  if (cached.length > 0) {
    return cached.filter(
      (m) =>
        !(
          m.role === 'assistant' &&
          isNoRecordReply(typeof m.content === 'string' ? m.content : '')
        ),
    ); // Hot path: in-memory is fresh enough
  }

  // Cold path: bot restarted — fetch from 0G Storage
  try {
    const stored = await getRecent(userId);
    const history = stored
      .filter(
        (m) => !(m.role === 'assistant' && isNoRecordReply(m.content)),
      )
      .map(storedToChat);
    setHistory(userId, history);
    return history;
  } catch {
    return []; // If 0G Storage is down, start fresh
  }
}

/**
 * Format a SearchEntry into a readable timestamped line for context injection.
 */
function formatSearchEntry(e: SearchEntry): string {
  const ts =
    new Date(e.ts).toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'short',
      timeStyle: 'short',
    }) + ' UTC';

  if (e.kind === 'msg') {
    const msg = e as unknown as StoredMessage;
    return `[${ts}] ${msg.role}: ${msg.content}`;
  }
  if (e.kind === 'tool') {
    const t = e as unknown as StoredToolCall;
    return `[${ts}] tool call: ${t.tool}`;
  }
  if (e.kind === 'tx') {
    const tx = e as unknown as StoredTx;
    return `[${ts}] transaction: ${tx.type} ${tx.hash}`;
  }
  return `[${ts}] unknown entry`;
}

/**
 * Split a long message into chunks of at most MAX_LEN characters,
 * splitting at the last newline before the limit (if possible).
 * Telegram has a 4096-char limit per message.
 */
const MAX_MSG_LEN = 4000;

function splitLongMessage(text: string): string[] {
  if (text.length <= MAX_MSG_LEN) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MSG_LEN) {
      parts.push(remaining);
      break;
    }
    // Try to split at newline within the limit
    let splitAt = remaining.lastIndexOf('\n', MAX_MSG_LEN);
    if (splitAt < MAX_MSG_LEN / 2) {
      // No good newline break, split at word boundary
      splitAt = remaining.lastIndexOf(' ', MAX_MSG_LEN);
      if (splitAt < MAX_MSG_LEN / 2) splitAt = MAX_MSG_LEN; // hard split
    }
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return parts;
}

/**
 * grammY message handler for natural-language text messages.
 *
 * Every non-command text message from a user is routed here, passed to
 * the AI agent (which calls 0G Compute), and the agent's reply is sent
 * back to the user with quick-action buttons and progressive loading states.
 *
 * IMPORTANT: This handler must be registered AFTER all /commands and inline-button
 * callback handlers, so they take precedence over free-text AI routing.
 */
export async function handleAiMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;

  if (!userId || !text) {
    return; // Nothing to do
  }

  // ── Progressive loading state ──
  // Send a status message and progressively edit it as steps complete.
  // The message stays visible during the slowest part (LLM inference ~5-10s)
  // and is deleted right before the real reply is sent.
  const loadingMsg = await ctx.reply('📖 Loading your history...').catch(() => null);
  await ctx.replyWithChatAction('typing');

  try {
    // ── Step 1: Load conversation history (from cache or 0G Storage) ──
    // This populates the memory.ts cache so subsequent search() is instant.
    // (The loading message is already '📖 Loading your history...' from above)
    await ctx.replyWithChatAction('typing');
    const history = await loadHistory(userId);

    // ── Step 2: Build memory context BEFORE recording the user's message ──
    // (The '🤖 Asking your AI agent...' edit is done before runAgent below)
    await ctx.replyWithChatAction('typing');

    let memoryContext: string | undefined;
    try {
      const wide = await search(userId, undefined, undefined, undefined, 50);
      const filtered = wide.filter((e: SearchEntry) => {
        if (e.kind === 'msg' && (e as unknown as StoredMessage).role === 'assistant') {
          if (isNoRecordReply((e as unknown as StoredMessage).content || '')) return false;
        }
        return true;
      });

      const recentLines = filtered.slice(0, 15).map(formatSearchEntry);
      const earliestLines = filtered.slice(-3).reverse().map(formatSearchEntry);

      if (recentLines.length > 0 || earliestLines.length > 0) {
        const blocks: string[] = [];
        if (earliestLines.length > 0) {
          blocks.push(
            'EARLIEST INTERACTIONS (your very first chats with this user — use these to answer "what was my first chat?" questions):\n' +
              earliestLines.join('\n'),
          );
        }
        if (recentLines.length > 0) {
          blocks.push('RECENT INTERACTIONS (most recent, newest first):\n' + recentLines.join('\n'));
        }
        memoryContext = blocks.join('\n\n');
      }
    } catch {
      // best-effort — LLM can still call search_history if needed
    }

    // ── Step 3: Persist user message to 0G Storage (best-effort, non-blocking) ──
    recordMessage(userId, 'user', text).catch(() => {});

    // Keep loading message visible during LLM inference (the slowest step ~5-10s)
    // It will be deleted right before the reply is sent
    if (loadingMsg) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        loadingMsg.message_id,
        '🤖 Asking your AI agent...',
      ).catch(() => {});
    }
    await ctx.replyWithChatAction('typing');

    const { reply, iterations, status } = await runAgent(userId, text, history, undefined, memoryContext);

    // Log for debugging
    console.log(
      `[ai] user=${userId} iters=${iterations} status=${status} reply_len=${reply.length}`,
    );

    // Delete the loading message before sending the real reply
    if (loadingMsg) {
      ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    }

    // ── Send the reply with quick-action buttons ──
    // Split long messages and send each part
    const parts = splitLongMessage(reply);
    for (let i = 0; i < parts.length; i++) {
      // Only attach action keyboard to the LAST part
      const kb = i === parts.length - 1 ? actionKeyboard() : undefined;
      await ctx.reply(parts[i], {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
    }

    // F1: persist assistant reply to 0G Storage (best-effort, non-blocking).
    recordMessage(userId, 'assistant', reply).catch(() => {});

    // Update in-memory cache
    setHistory(userId, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ]);
  } catch (e) {
    console.error('[aiHandler] agent run failed:', e);
    // Delete loading message if it exists
    if (loadingMsg) {
      ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    }
    await ctx.reply(
      [
        '⚠️ I had trouble processing that.',
        '',
        'This might be a temporary issue with 0G Compute. Please try again in a moment.',
        'If the problem persists, use /help to see commands that work without AI.',
      ].join('\n'),
      {
        reply_markup: new InlineKeyboard().text('❓ Help', 'action:help'),
      },
    );
  }
}

/**
 * Clear conversation history for a user (e.g., on /restart).
 * Clears both the in-memory cache AND the 0G Storage index.
 */
export async function clearHistory(userId: string): Promise<void> {
  histories.delete(userId);
  const { clearMemory } = await import('../ai/memory');
  await clearMemory(userId);
}
