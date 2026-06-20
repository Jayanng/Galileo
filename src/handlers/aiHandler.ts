import type { Context } from 'grammy';
import { runAgent } from '../ai/agent';
import type { ChatMessage } from '../og/compute';

/**
 * In-memory conversation history per Telegram user.
 *
 * LIMITATION: This is reset on bot restart. F1 (Infinite Wallet Memory)
 * will replace this with 0G Storage KV persistence in a later phase.
 *
 * We cap each user's history at MAX_HISTORY_MESSAGES to bound memory use.
 * Older messages are dropped (FIFO).
 */
const MAX_HISTORY_MESSAGES = 20;
const histories = new Map<string, ChatMessage[]>();

function getHistory(userId: string): ChatMessage[] {
  return histories.get(userId) ?? [];
}

function setHistory(userId: string, history: ChatMessage[]): void {
  // Keep only the most recent N messages
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  histories.set(userId, trimmed);
}

/**
 * grammY message handler for natural-language text messages.
 *
 * This REPLACES the regex-based NL router in src/bot.ts.
 * Every non-command text message from a user is routed here, passed to
 * the AI agent (which calls 0G Compute), and the agent's reply is sent
 * back to the user.
 *
 * IMPORTANT: This handler must be registered AFTER the `naming` interceptor
 * (so wallet-naming flow takes precedence) and AFTER all /commands.
 */
export async function handleAiMessage(ctx: Context): Promise<void> {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : null;

  if (!userId || !text) {
    return; // Nothing to do
  }

  // Show "typing..." indicator while the LLM thinks (can take 1–5 seconds)
  await ctx.replyWithChatAction('typing');

  try {
    const history = getHistory(userId);
    const { reply, iterations, status } = await runAgent(userId, text, history);

    // Update conversation history for this user
    setHistory(userId, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    ]);

    // Log for debugging (remove or reduce in production)
    console.log(
      `[ai] user=${userId} iters=${iterations} status=${status} reply_len=${reply.length}`,
    );

    // Send the reply. Use Markdown parse_mode so backticked addresses render as monospace.
    await ctx.reply(reply, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[aiHandler] agent run failed:', e);
    await ctx.reply(
      [
        '⚠️ I had trouble processing that.',
        '',
        'This might be a temporary issue with 0G Compute. Please try again in a moment.',
        'If the problem persists, use /help to see commands that work without AI.',
      ].join('\n'),
    );
  }
}

/**
 * Clear conversation history for a user (e.g., on /restart).
 * Not currently used but exported for future use.
 */
export function clearHistory(userId: string): void {
  histories.delete(userId);
}
