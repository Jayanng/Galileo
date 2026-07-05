import { InlineKeyboard, type Context } from 'grammy';
import { runAgent } from '../ai/agent';
import { recordMessage, recordProof, getRecent, search } from '../ai/memory';
import { config } from '../config';
import { pendingSwaps } from '../swap/pendingSwap';
import { swapConfirmKeyboard } from './swapUiHandlers';
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

/**
 * How many recent history turns to actually send to the LLM per request.
 *
 * The full 20-message cache is retained for continuity, but resending all of
 * it on EVERY agent iteration (up to MAX_ITERATIONS) is the main driver of
 * token burn — and the 0G Compute free tier caps at 2000 tokens/min. The
 * model still has the injected `memoryContext` summary plus the
 * `search_history` tool for anything older, so trimming the raw transcript
 * here trades little quality for a large reduction in tokens/min.
 */
const HISTORY_FOR_LLM = 6;

// ── Random loading messages that continuously rotate while the AI works ──
// A single pool of messages; a timed interval cycles through them every ~3.5s
// so the user sees fresh text right up until the real reply lands.

const LOADING_MESSAGES = [
  '🤔 Processing your request...',
  '🔄 Working on it...',
  '⚙️ Crunching data...',
  '📡 Connecting...',
  '💭 Thinking...',
  '🔍 Looking things up...',
  '⏳ Just a moment...',
  '✨ Almost there...',
  '🔮 Checking...',
  '🧩 Putting it together...',
  '🎯 Focusing...',
  '📊 Gathering info...',
  '🔬 Examining...',
  '💡 Running the numbers...',
  '🌀 Processing...',
  '🎲 Computing...',
  '⏰ One sec...',
  '🔎 Searching...',
  '💪 On it...',
  '🚀 Getting that for you...',
  '🤖 Asking your AI agent...',
  '🧠 Consulting the AI...',
  '💬 Talking to the model...',
  '⚡ Running inference...',
  '🔄 Processing with AI...',
  '🔮 AI is thinking...',
  '📡 Querying the AI...',
  '💭 AI is analyzing...',
  '🎯 Getting the AI response...',
  '🧩 Assembling the answer...',
  '✨ Checking with AI...',
  '🔬 Deep analysis...',
  '💡 Computing best response...',
  '🔄 Consulting AI...',
  '🤔 AI is working...',
  '📊 AI crunching data...',
  '⚡ AI processing...',
  '💪 The AI is on it...',
  '🚀 AI thinking...',
  '🎲 Running through AI...',
];

/** How often the loading message rotates (milliseconds). */
const LOADING_ROTATION_MS = 3_500;

function pickRandomMessage(exclude?: string): string {
  let msg: string;
  do {
    msg = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]!;
  } while (msg === exclude && LOADING_MESSAGES.length > 1);
  return msg;
}

/**
 * Start a timed rotation that edits `loadingMsg` with a new random message
 * every `LOADING_ROTATION_MS`. Returns a function that stops the rotation.
 */
function startLoadingRotation(
  ctx: Context,
  loadingMsg: { message_id: number },
): () => void {
  let current = pickRandomMessage();
  const chatId = ctx.chat!.id;
  const timer = setInterval(() => {
    const next = pickRandomMessage(current);
    current = next;
    ctx.api.editMessageText(chatId, loadingMsg.message_id, next).catch(() => {});
  }, LOADING_ROTATION_MS);
  return () => {
    clearInterval(timer);
  };
}

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
  if (e.kind === 'proof') {
    const p = e as unknown as { chatID: string; providerAddress: string; verified: boolean | null };
    const status = p.verified === true ? 'verified' : p.verified === false ? 'invalid' : 'pending';
    return `[${ts}] TEE proof (${status}): chatID=0x${p.chatID.slice(2, 12)}…${p.chatID.slice(-6)} provider=0x${p.providerAddress.slice(2, 8)}…${p.providerAddress.slice(-4)}`;
  }
  return `[${ts}] unknown entry`;
}

/**
 * Build the TEE verification footer line appended to every AI reply.
 *
 * Rules (in order of precedence):
 *   1. OG_COMPUTE_FALLBACK=true → "ℹ️ TEE verification unavailable (fallback mode)"
 *   2. verified === true  → "✅ Verified in TEE — chatID: `0xfirst10…last6`"
 *   3. verified === false → "⚠️ TEE signature invalid — chatID: `0xfirst10…last6`"
 *   4. verified === null  → "🔄 TEE verification pending — chatID: `0xfirst10…last6`"
 *
 * Returns an empty string if none of the above apply (shouldn't happen).
 */
function buildTeeFooter(opts: {
  verified: boolean | null;
  chatID: string | null;
  providerAddress: string | null;
}): string {
  if (config.OG_COMPUTE_FALLBACK) {
    return '_ℹ️ TEE verification unavailable (fallback mode)_';
  }
  if (opts.chatID) {
    const short = `0x${opts.chatID.slice(2, 12)}…${opts.chatID.slice(-6)}`;
    if (opts.verified === true) return `_✅ Verified in TEE — chatID: \`${short}\`_`;
    if (opts.verified === false) return `_⚠️ TEE signature invalid — chatID: \`${short}\`_`;
    return `_🔄 TEE verification pending — chatID: \`${short}\`_`;
  }
  // No chatID at all — verification could not be attempted
  return '_ℹ️ TEE verification unavailable (no chatID returned)_';
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
  // Send a rotating status message that continuously changes until the AI
  // response is ready. Deleted right before the real reply is sent.
  const loadingMsg = await ctx.reply(pickRandomMessage()).catch(() => null);
  const stopRotation = loadingMsg ? startLoadingRotation(ctx, loadingMsg) : () => {};
  await ctx.replyWithChatAction('typing');

  let history: ChatMessage[] = [];
  let memoryContext: string | undefined;

  try {
    // ── Step 1: Load conversation history (from cache or 0G Storage) ──
    // This populates the memory.ts cache so subsequent search() is instant.
    // Rotation is already running; the user sees different text every ~3.5s.
    await ctx.replyWithChatAction('typing');
    history = await loadHistory(userId);

    // ── Step 2: Build memory context BEFORE recording the user's message ──
    // (The '🤖 Asking your AI agent...' edit is done before runAgent below)
    await ctx.replyWithChatAction('typing');

    try {
      const wide = await search(userId, undefined, undefined, undefined, 50);
      const filtered = wide.filter((e: SearchEntry) => {
        if (e.kind === 'msg' && (e as unknown as StoredMessage).role === 'assistant') {
          if (isNoRecordReply((e as unknown as StoredMessage).content || '')) return false;
        }
        return true;
      });

      const recentLines = filtered.slice(0, 5).map(formatSearchEntry);

      if (recentLines.length > 0) {
        memoryContext = 'RECENT INTERACTIONS (most recent, newest first):\n' + recentLines.join('\n');
      }
    } catch {
      // best-effort — LLM can still call search_history if needed
    }

    // ── Step 3: Persist user message to 0G Storage (best-effort, non-blocking) ──
    recordMessage(userId, 'user', text).catch(() => {});

    // Loading message is already rotating — it keeps cycling until the AI
    // responds. It will be deleted right before the reply is sent.
    await ctx.replyWithChatAction('typing');

    // Send only the most recent turns to the LLM to keep per-request token
    // usage bounded (see HISTORY_FOR_LLM). Full history stays in cache + 0G
    // Storage and remains reachable via the search_history tool.
    const historyForLlm = history.slice(-HISTORY_FOR_LLM);

    const { reply, iterations, status, verified, chatID, providerAddress } = await runAgent(
      userId,
      text,
      historyForLlm,
      undefined,
      memoryContext,
    );

    // Log for debugging
    console.log(
      `[ai] user=${userId} iters=${iterations} status=${status} reply_len=${reply.length} verified=${verified ?? 'null'} chatID=${chatID ?? 'none'}`,
    );

    // Stop the rotation and delete the loading message before sending the reply
    stopRotation();
    if (loadingMsg) {
      ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    }

    // ── Build the TEE verification footer ──
    // Every AI reply must carry exactly one footer line. The exact form
    // depends on whether we are in fallback mode and on the verification
    // outcome of the final assistant turn.
    const footer = buildTeeFooter({ verified, chatID, providerAddress });
    const finalReply = footer ? `${reply}\n\n${footer}` : reply;

    // F1: persist the proof to 0G Storage (best-effort, non-blocking).
    // Skip when fallback mode — there is no proof to record.
    if (!config.OG_COMPUTE_FALLBACK) {
      recordProof(userId, {
        chatID: chatID ?? '',
        providerAddress: providerAddress ?? '',
        verified,
      }).catch(() => {});
    }

    // ── Send the reply with quick-action buttons ──
    // Split long messages and send each part. If a swap was just prepared, attach a
    // Confirm/Cancel keyboard to the last part (nothing executes until confirmed).
    const swapKb = pendingSwaps.get(userId) ? swapConfirmKeyboard() : undefined;
    const parts = splitLongMessage(finalReply);
    for (let i = 0; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: 'Markdown',
        reply_markup: i === parts.length - 1 ? swapKb : undefined,
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

    const msg = (e as Error).message ?? '';
    const isRateLimit = /429|too many requests|rate.?limit/i.test(msg);

    // ── 429 handling: retry with backoff, then queue ──
    if (isRateLimit) {
      const waitMatch = msg.match(/wait\s+(\d+)\s+seconds/i);
      const waitSec = waitMatch ? parseInt(waitMatch[1]!, 10) : 5;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const delay = Math.max(waitSec, Math.pow(2, attempt)) * 1000;
        console.log(
          `[aiHandler] rate limited — retry ${attempt + 1}/${maxRetries} in ${Math.round(delay / 1000)}s`,
        );

        // Stop rotation and show a static rate-limit message
        stopRotation();
        if (loadingMsg) {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            loadingMsg.message_id,
            `⏳ Rate limited — retrying in ${Math.round(delay / 1000)}s...`,
          ).catch(() => {});
        }

        await new Promise((r) => setTimeout(r, delay));
        await ctx.replyWithChatAction('typing');

        try {
          // Re-run the agent with the same inputs
          const historyForLlm = history.slice(-HISTORY_FOR_LLM);
          const retryResult = await runAgent(
            userId,
            text,
            historyForLlm,
            undefined,
            memoryContext,
          );

          stopRotation();
          if (loadingMsg) {
            ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
          }

          const retryFooter = buildTeeFooter({
            verified: retryResult.verified,
            chatID: retryResult.chatID,
            providerAddress: retryResult.providerAddress,
          });
          const retryReply = retryFooter ? `${retryResult.reply}\n\n${retryFooter}` : retryResult.reply;

          if (!config.OG_COMPUTE_FALLBACK) {
            recordProof(userId, {
              chatID: retryResult.chatID ?? '',
              providerAddress: retryResult.providerAddress ?? '',
              verified: retryResult.verified,
            }).catch(() => {});
          }

          const retryParts = splitLongMessage(retryReply);
          const retrySwapKb = pendingSwaps.get(userId) ? swapConfirmKeyboard() : undefined;
          for (let j = 0; j < retryParts.length; j++) {
            await ctx.reply(retryParts[j], {
              parse_mode: 'Markdown',
              reply_markup: j === retryParts.length - 1 ? retrySwapKb : undefined,
            });
          }

          recordMessage(userId, 'assistant', retryResult.reply).catch(() => {});
          setHistory(userId, [
            ...history,
            { role: 'user', content: text },
            { role: 'assistant', content: retryResult.reply },
          ]);
          return; // success after retry
        } catch (retryErr) {
          const retryMsg = (retryErr as Error).message ?? '';
          const stillRateLimited = /429|too many requests|rate.?limit/i.test(retryMsg);
          if (!stillRateLimited) {
            // Non-rate-limit error during retry — surface it
            stopRotation();
            if (loadingMsg) {
              ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
            }
            await ctx.reply(
              `⚠️ I had trouble processing that.\n\nError: ${retryMsg}\n\nIf the problem persists, use /help to see commands that work without AI.`,
              { reply_markup: new InlineKeyboard().text('❓ Help', 'home:help') },
            );
            return;
          }
          // Still rate limited — continue the retry loop
          console.warn(`[aiHandler] retry ${attempt + 1} still rate limited`);
        }
      }

      // All retries exhausted — show the user-friendly rate limit message
      stopRotation();
      if (loadingMsg) {
        ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
      }
      const waitHint = waitMatch ? ` (about ${waitSec} seconds)` : ' a few seconds';
      await ctx.reply(
        [
          '⏳ I\'m a bit busy right now and hit my usage limit.',
          '',
          `Please try again in${waitHint}.`,
          '',
          'Tip: commands like /wallet, /balance, /send and /portfolio work instantly without waiting.',
        ].join('\n'),
        {
          reply_markup: new InlineKeyboard().text('❓ Help', 'home:help'),
        },
      );
      return;
    }

    // Non-rate-limit error — show immediately
    // Stop rotation and delete loading message
    stopRotation();
    if (loadingMsg) {
      ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    }

    await ctx.reply(
      [
        '⚠️ I had trouble processing that.',
        '',
        `Error: ${msg}`,
        '',
        'If the problem persists, use /help to see commands that work without AI.',
      ].join('\n'),
      {
        reply_markup: new InlineKeyboard().text('❓ Help', 'home:help'),
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
