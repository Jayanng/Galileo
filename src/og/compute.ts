import OpenAI from 'openai';
import { config } from '../config';
import { getActiveProviderAddress, getBroker, isReady, ensureSubAccountFunded } from './computeBroker';

/**
 * 0G Compute client.
 *
 * Two execution paths, chosen at startup:
 *
 *   1. TEE-verified path (default).
 *      Uses `@0gfoundation/0g-compute-ts-sdk` to:
 *        - pick a TeeML chatbot provider,
 *        - sign each request with `getRequestHeaders`,
 *        - extract `ZG-Res-Key` (fallback: completion id) from the response,
 *        - verify the response with `processResponse`.
 *
 *      Every chat completion returns `{ message, chatID, providerAddress,
 *      verified, usage }`. `verified` is true when the provider's TEE signer
 *      signed the response, false when signature verification failed, and null
 *      when verification could not run (processResponse threw).
 *
 *   2. Legacy router path (only when `OG_COMPUTE_FALLBACK=true`).
 *      Keeps the original `OG_COMPUTE_BASE_URL` + `OG_COMPUTE_API_KEY` flow.
 *      No TEE verification is possible in this mode — `chatID`, `provider`,
 *      and `verified` are all null in the result.
 *
 * Why not stream? The agent loop in `src/ai/agent.ts` needs the full response
 * (including the chat ID) before it can run `processResponse` and continue
 * the loop. The `chatStream` helper is kept for callers that don't need
 * verification.
 */

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  usage?: OpenAI.Completions.CompletionUsage;
}

export interface ChatVerifiedResult extends ChatResult {
  /** chatID returned in the `ZG-Res-Key` response header (or fallback `id`). */
  chatID: string | null;
  /** Provider address that served the request. Null when in fallback mode. */
  providerAddress: string | null;
  /** True if the TEE signer signature was verified, false if it failed, null if verification was not attempted. */
  verified: boolean | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy client (fallback path only)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Legacy OpenAI-compatible client used only when `OG_COMPUTE_FALLBACK=true`.
 * Returns the same `ChatResult` shape as the verified path so callers don't
 * branch on which mode is active.
 */
const legacyClient = new OpenAI({
  baseURL: config.OG_COMPUTE_BASE_URL,
  apiKey: config.OG_COMPUTE_API_KEY,
  timeout: 60 * 1000,
  maxRetries: 0,
});

/**
 * Legacy chat completion. No verification, no chatID, no provider.
 */
export async function chat(
  messages: ChatMessage[],
  tools?: ChatTool[],
): Promise<ChatResult> {
  const response = await legacyClient.chat.completions.create({
    model: config.OG_COMPUTE_MODEL,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
  });

  return {
    message: response.choices[0].message,
    usage: response.usage,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency limiter — max 3 concurrent LLM requests to the provider.
// Prevents overwhelming the provider's rate limit or causing wallet nonce
// conflicts. Excess requests queue and wait for a slot.
// ─────────────────────────────────────────────────────────────────────────

const MAX_CONCURRENT = 3;
let activeRequests = 0;
const pendingQueue: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return;
  }
  return new Promise((resolve) => {
    pendingQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  if (pendingQueue.length > 0) {
    const next = pendingQueue.shift();
    next?.();
  } else {
    activeRequests--;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Retry helper — exponential backoff for transient failures (429, 5xx).
// On 429, parses the provider's "wait N seconds" hint and sleeps that long.
// ─────────────────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    // Don't retry 400-499 except 429 (rate limit)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return response; // caller will throw with the actual status
    }

    if (attempt < maxRetries - 1) {
      let delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s, 16s

      // On 429, parse the provider's "wait N seconds" hint and honour it
      if (response.status === 429) {
        try {
          const body = await response.text();
          const waitMatch = body.match(/wait\s+(\d+)\s+seconds/i);
          if (waitMatch) {
            delay = Math.max(parseInt(waitMatch[1]!, 10) * 1000, 2000);
          }
          console.warn(`[compute] 429 rate limit (attempt ${attempt + 1}/${maxRetries}): ${body.slice(0, 200)}`);
        } catch {
          // body read failed — fall back to exponential backoff
        }
      }

      console.warn(
        `[compute] retry ${attempt + 1}/${maxRetries} after ${Math.round(delay / 1000)}s (status ${response.status})`,
      );
      await new Promise((r) => setTimeout(r, delay));
    } else {
      return response; // last attempt failed, return the error
    }
  }
  // TypeScript unreachable with `never`, but this keeps TS happy:
  throw new Error('fetchWithRetry: unreachable');
}

// ─────────────────────────────────────────────────────────────────────────
// Token-budget rate limiter — tracks actual token usage over a rolling
// 60-second window and gates new requests when recent usage approaches
// the provider's per-minute token limit (default: 2000 tokens/min).
//
// This works in concert with fetchWithRetry's 429 handling:
//   - waitForTokenBudget() runs BEFORE the request to prevent most 429s
//   - fetchWithRetry handles the ones that slip through (e.g. concurrent)
// ─────────────────────────────────────────────────────────────────────────

const RATE_LIMIT_TOKENS_PER_MIN = 2000;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Per-user token usage windows.
 *
 * Each Telegram user gets an INDEPENDENT 2,000 tokens/min budget. This means
 * user A's heavy usage does NOT block user B — they have separate buckets.
 *
 * The provider's rate limit is shared at the operator-account level, so if
 * combined usage across all users exceeds 2,000/min, the provider will still
 * return 429s. Those are handled gracefully by fetchWithRetry's backoff.
 * But this per-user gate ensures one user can't preemptively block another
 * from even starting a request.
 *
 * Map<userId, Array<usage entries>> — entries are pruned after 60s.
 * Empty windows are deleted from the map to prevent unbounded growth.
 */
const perUserTokenWindows = new Map<string, Array<{ ts: number; tokens: number }>>();

/**
 * Rough token estimate for a set of chat messages.
 *
 * We can't know the true prompt cost until the provider responds, but the
 * budget gate must reserve *something* up front — otherwise the agent loop's
 * back-to-back iterations all sail through before any usage is recorded, and
 * we overshoot the per-minute limit mid-loop (the classic cause of 429s).
 *
 * Heuristic: ~4 characters per token (OpenAI's rule of thumb), plus a small
 * per-message overhead for role/formatting tokens. Tool definitions add a
 * fixed pad. This deliberately over-estimates a little so we throttle *before*
 * hitting the wall rather than after.
 */
function estimateTokens(messages: ChatMessage[], tools?: ChatTool[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          chars += part.text.length;
        }
      }
    }
    chars += 16; // per-message role/formatting overhead
  }
  const toolPad = tools && tools.length > 0 ? tools.length * 120 : 0;
  // +completion headroom: reserve for the model's reply as well, so a full
  // round-trip is accounted for, not just the prompt.
  return Math.ceil(chars / 4) + toolPad + 256;
}

/** Sum the user's non-expired token usage in the rolling window (prunes in place). */
function rollingUsage(userId: string, now: number): { window: Array<{ ts: number; tokens: number }>; used: number } {
  const window = perUserTokenWindows.get(userId) ?? [];
  while (window.length > 0 && window[0]!.ts < now - RATE_LIMIT_WINDOW_MS) {
    window.shift();
  }
  const used = window.reduce((sum, e) => sum + e.tokens, 0);
  return { window, used };
}

/**
 * Block until the rolling 60-second token usage for THIS user, PLUS the
 * estimated cost of the request we're about to send, fits within the per-user
 * limit. Called before every provider request.
 *
 * Reserving the estimated cost up front is what makes the agent loop
 * self-throttle: iteration N+1 sees iteration N's estimate already reserved
 * (via a placeholder entry), so it waits instead of firing blindly. The
 * placeholder is reconciled with the true usage in recordTokenUsage().
 *
 * When a single request's estimate already exceeds the per-minute limit
 * (common with the large system prompt + tools), the gate allows it through
 * with a warning — blocking it would deadlock since it can never fit.
 * Consecutive large requests are then blocked by the rolling window until
 * older entries expire.
 *
 * @param userId    Telegram user ID. When undefined (e.g. startup ping),
 *                  the rate limiter is skipped entirely.
 * @param estimated Estimated token cost of the imminent request.
 */
async function waitForTokenBudget(userId?: string, estimated = 0): Promise<void> {
  if (!userId) return; // startup/health-check pings skip the gate

  const startedAt = Date.now();
  const MAX_WAIT_MS = 65_000;

  while (true) {
    const now = Date.now();

    if (now - startedAt > MAX_WAIT_MS) {
      console.warn(
        `[compute] rate-limit gate (user=${userId}): waited >${Math.round(MAX_WAIT_MS / 1000)}s — releasing`,
      );
      return;
    }

    const { window, used } = rollingUsage(userId, now);

    if (used + estimated <= RATE_LIMIT_TOKENS_PER_MIN) {
      if (window.length > 0) perUserTokenWindows.set(userId, window);
      else perUserTokenWindows.delete(userId);
      return;
    }

    // When a single request alone blows the budget (e.g. system prompt + tools
    // is ~7K tokens) and the user hasn't used anything in the current window,
    // blocking it forever is a deadlock — every future check also fails.
    // Allow it through and let the global gate + provider 429 backstop handle it.
    if (used === 0) {
      console.warn(
        `[compute] rate-limit gate (user=${userId}): single-request est ${estimated} > ${RATE_LIMIT_TOKENS_PER_MIN} limit — allowing through (used=0)`,
      );
      perUserTokenWindows.delete(userId);
      return;
    }

    perUserTokenWindows.set(userId, window);

    // Wait until the oldest entry expires (or a floor of 1s to avoid a busy loop).
    const oldestTs = window[0]!.ts;
    const remaining = oldestTs + RATE_LIMIT_WINDOW_MS - now;
    const waitMs = Math.max(1000, remaining + 500);
    console.warn(
      `[compute] rate-limit gate (user=${userId}): ${used}+${estimated} est / ${RATE_LIMIT_TOKENS_PER_MIN} tokens in last 60s — waiting ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Record actual token usage for a specific user after a provider response.
 * Called from doChatVerified() with response.usage data.
 *
 * @param userId  Telegram user ID (or undefined for startup pings)
 * @param usage   OpenAI usage object from the provider response
 */
function recordTokenUsage(
  userId: string | undefined,
  usage: OpenAI.Completions.CompletionUsage | undefined,
  reservationTs: number | null = null,
): void {
  const tokens = usage ? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) : 0;

  // Startup pings (no userId) don't track against any user's budget
  if (!userId) {
    if (usage) {
      console.log(
        `[compute] tokens: prompt=${usage.prompt_tokens ?? 0} completion=${usage.completion_tokens ?? 0} total=${tokens} (system, not tracked)`,
      );
    }
    return;
  }

  const window = perUserTokenWindows.get(userId) ?? [];

  // Reconcile the up-front reservation: drop the placeholder entry we added
  // in reserveTokens() so we don't double-count (reserved estimate + real).
  if (reservationTs !== null) {
    const idx = window.findIndex((e) => e.ts === reservationTs);
    if (idx !== -1) window.splice(idx, 1);
  }

  if (tokens > 0) {
    window.push({ ts: Date.now(), tokens });
  }
  if (window.length > 0) perUserTokenWindows.set(userId, window);
  else perUserTokenWindows.delete(userId);

  // Also track in the global (account-level) window
  recordGlobalTokenUsage(tokens);

  const rolling = window.reduce((s, e) => s + e.tokens, 0);
  if (usage) {
    console.log(
      `[compute] tokens (user=${userId}): prompt=${usage.prompt_tokens ?? 0} completion=${usage.completion_tokens ?? 0} total=${tokens} | rolling 60s: ${rolling}/${RATE_LIMIT_TOKENS_PER_MIN}`,
    );
  }
}

/**
 * Release a reservation without recording real usage — called when a request
 * throws (network error, exhausted 429 retries) so a failed call doesn't leave
 * an inflated placeholder blocking the user's budget for a full minute.
 */
function releaseReservation(userId: string | undefined, reservationTs: number | null): void {
  if (!userId || reservationTs === null) return;
  const window = perUserTokenWindows.get(userId);
  if (!window) return;
  const idx = window.findIndex((e) => e.ts === reservationTs);
  if (idx !== -1) window.splice(idx, 1);
  if (window.length > 0) perUserTokenWindows.set(userId, window);
  else perUserTokenWindows.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────
// Global (account-level) rate limiter — tracks combined token usage across
// ALL users. The 0G Compute free tier caps at 2000 tokens/min per operator
// account, NOT per user. Without this gate, two users each using 1200 tokens
// in the same minute would trigger a provider 429 even though each stayed
// under their per-user budget.
// ─────────────────────────────────────────────────────────────────────────

const globalTokenWindow: Array<{ ts: number; tokens: number }> = [];

function globalRollingUsage(now: number): { used: number } {
  while (globalTokenWindow.length > 0 && globalTokenWindow[0]!.ts < now - RATE_LIMIT_WINDOW_MS) {
    globalTokenWindow.shift();
  }
  const used = globalTokenWindow.reduce((sum, e) => sum + e.tokens, 0);
  return { used };
}

/**
 * Block until combined token usage across ALL users, PLUS the estimated cost
 * of this request, fits within the account-level 2000 tokens/min limit.
 *
 * Like the per-user gate, a single oversized request is allowed through
 * (with a warning) rather than deadlocked. The provider 429 backstop still
 * applies for the remaining headroom.
 */
async function waitForGlobalTokenBudget(userId?: string, estimated = 0): Promise<void> {
  if (!userId) return;

  const startedAt = Date.now();
  const MAX_WAIT_MS = 65_000;

  while (true) {
    const now = Date.now();

    if (now - startedAt > MAX_WAIT_MS) {
      console.warn(
        `[compute] global rate-limit gate: waited >${Math.round(MAX_WAIT_MS / 1000)}s — releasing`,
      );
      return;
    }

    const { used } = globalRollingUsage(now);

    if (used + estimated <= RATE_LIMIT_TOKENS_PER_MIN) return;

    if (used === 0) {
      console.warn(
        `[compute] global rate-limit gate: single-request est ${estimated} > ${RATE_LIMIT_TOKENS_PER_MIN} limit — allowing through (globalUsed=0)`,
      );
      return;
    }

    const oldestTs = globalTokenWindow[0]!.ts;
    const remaining = oldestTs + RATE_LIMIT_WINDOW_MS - now;
    const waitMs = Math.max(1000, remaining + 500);
    console.warn(
      `[compute] global rate-limit gate: ${used}+${estimated} est / ${RATE_LIMIT_TOKENS_PER_MIN} tokens in last 60s — waiting ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** Record actual usage in the global window (called from recordTokenUsage). */
function recordGlobalTokenUsage(tokens: number): void {
  if (tokens > 0) {
    globalTokenWindow.push({ ts: Date.now(), tokens });
    while (globalTokenWindow.length > 0 && globalTokenWindow[0]!.ts < Date.now() - RATE_LIMIT_WINDOW_MS) {
      globalTokenWindow.shift();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Verified path: official 0G Compute SDK
// ─────────────────────────────────────────────────────────────────────────

interface VerifiedCallOptions {
  /** User-supplied text. Required by getRequestHeaders for fee calculation. */
  userContent?: string;
  /**
   * Telegram user ID. Used for per-user rate limiting. When undefined
   * (e.g. startup ping), the rate limiter is skipped entirely.
   */
  userId?: string;
}

interface OpenAICompletionBody {
  id: string;
  choices: Array<{ message: OpenAI.Chat.Completions.ChatCompletionMessage; finish_reason?: string }>;
  model?: string;
  usage?: OpenAI.Completions.CompletionUsage;
}

/**
 * Verified chat completion via the 0G Compute Network SDK.
 *
 * Signs the request with `getRequestHeaders`, POSTs directly to the provider's
 * `/chat/completions` endpoint (we need raw `fetch` so we can read the
 * `ZG-Res-Key` response header), then calls `processResponse` to verify the
 * provider's TEE signer signature.
 *
 * If `processResponse` throws, we log a warning and set `verified = null` —
 * the message itself is still returned, but the caller should surface a
 * "verification pending" footer.
 *
 * Rate-limit protection:
 *   - Concurrency limited to MAX_CONCURRENT (3) simultaneous requests.
 *   - Retries with 1s/2s/4s backoff on 429 (rate limit) and 5xx errors.
 */
export async function chatVerified(
  messages: ChatMessage[],
  tools: ChatTool[] | undefined,
  opts: VerifiedCallOptions = {},
): Promise<ChatVerifiedResult> {
  // Fallback: keep the legacy shape if the operator opted out.
  if (config.OG_COMPUTE_FALLBACK || !isReady()) {
    const r = await chat(messages, tools);
    return { ...r, chatID: null, providerAddress: null, verified: null };
  }

  const providerAddress = getActiveProviderAddress();
  if (!providerAddress) {
    const r = await chat(messages, tools);
    return { ...r, chatID: null, providerAddress: null, verified: null };
  }

  // Estimate this request's token cost and gate on (past usage + estimate),
  // then RESERVE the estimate so concurrent/looping requests see it too.
  // Both per-user and global (account-level) gates are checked — the provider's
  // 2000 tokens/min limit is per operator account, not per Telegram user.
  const estimated = estimateTokens(messages, tools);
  await waitForTokenBudget(opts.userId, estimated);
  await waitForGlobalTokenBudget(opts.userId, estimated);
  const reservationTs = reserveTokens(opts.userId, estimated);

  // Acquire concurrency slot before any SDK/network calls
  await acquireSlot();
  try {
    return await doChatVerified(messages, tools, opts, providerAddress, reservationTs);
  } catch (err) {
    // A failed request (network error, exhausted 429 retries) never reaches
    // recordTokenUsage, so release the reservation here to avoid blocking the
    // user's budget with a phantom estimate for a full minute.
    releaseReservation(opts.userId, reservationTs);
    throw err;
  } finally {
    releaseSlot();
  }
}

/**
 * Reserve estimated tokens against the user's rolling window as a placeholder
 * entry, returning its timestamp so recordTokenUsage() can reconcile it with
 * the true usage once the provider responds. Returns null when unreserved
 * (no userId).
 */
function reserveTokens(userId: string | undefined, estimated: number): number | null {
  if (!userId || estimated <= 0) return null;
  const ts = Date.now();
  const window = perUserTokenWindows.get(userId) ?? [];
  window.push({ ts, tokens: estimated });
  perUserTokenWindows.set(userId, window);
  return ts;
}

/**
 * Inner implementation of chatVerified, called inside the concurrency slot.
 * Extracted so the semaphore logic stays clean.
 */
async function doChatVerified(
  messages: ChatMessage[],
  tools: ChatTool[] | undefined,
  opts: VerifiedCallOptions,
  providerAddress: string,
  reservationTs: number | null = null,
): Promise<ChatVerifiedResult> {
  const broker = getBroker();
  const startedAt = Date.now();

  console.log(`[compute] getServiceMetadata for ${providerAddress}...`);
  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
  console.log(`[compute] endpoint=${endpoint} model=${model} (${Date.now() - startedAt}ms)`);

  console.log(`[compute] getRequestHeaders...`);
  const headers = await broker.inference.getRequestHeaders(providerAddress, opts.userContent);
  console.log(`[compute] headers obtained (${Date.now() - startedAt}ms acquired)`);

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as unknown as Record<string, string>),
  };

  const body = JSON.stringify({
    model,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
  });

  const url = `${endpoint}/chat/completions`;
  console.log(`[compute] POST ${url} (${Date.now() - startedAt}ms elapsed)...`);

  // Use fetchWithRetry for transient failures
  const fetchRes = await fetchWithRetry(url, { method: 'POST', headers: fetchHeaders, body });
  console.log(`[compute] response status=${fetchRes.status} (${Date.now() - startedAt}ms elapsed)`);

  if (!fetchRes.ok) {
    const text = await fetchRes.text().catch(() => '');
    const errMsg = `0G Compute provider returned ${fetchRes.status} ${fetchRes.statusText}: ${text.slice(0, 500)}`;
    console.error(`[compute] ${errMsg}`);
    throw new Error(errMsg);
  }

  // Read chatID from the dedicated header before consuming the body. The
  // provider may omit it, in which case we fall back to completion.id.
  const zgResKey = fetchRes.headers.get('ZG-Res-Key');
  const bodyJson = (await fetchRes.json()) as OpenAICompletionBody;
  const chatID = zgResKey ?? bodyJson.id ?? null;

  // Record actual token usage for the rate limiter + log it. This also
  // reconciles the up-front reservation (reservationTs) with the true cost.
  recordTokenUsage(opts.userId, bodyJson.usage, reservationTs);

  // Build usage JSON for the broker's processResponse (fee caching).
  const usage = bodyJson.usage;
  let usageJson: string | undefined;
  if (usage) {
    usageJson = JSON.stringify({
      type: 'tokens',
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    });
  }

    let verified: boolean | null = null;
  if (chatID) {
    try {
      verified = await broker.inference.processResponse(providerAddress, chatID, usageJson);
    } catch (e) {
      console.error(`[compute] processResponse failed: ${(e as Error).message}`);
      verified = null;
    }
  }

  // Auto-top-up: after every 5 successful inferences, check the sub-account
  // balance and refill if it drops below OG_COMPUTE_FUND_AMOUNT.
  // This ensures the bot never runs out of inference credits as long as the
  // operator wallet has OG to deposit into the main ledger.
  {
    const topUpCounter = topUpCounterMap.get(providerAddress) ?? 0;
    const newCount = topUpCounter + 1;
    topUpCounterMap.set(providerAddress, newCount);
    if (newCount >= 5) {
      topUpCounterMap.set(providerAddress, 0); // reset counter
      console.log(`[compute] auto-top-up check #${newCount} for ${providerAddress}`);
      ensureSubAccountFunded(broker, providerAddress).catch((err) =>
        console.warn(`[compute] auto-top-up failed: ${(err as Error).message}`),
      );
    }
  }

  return {
    message: bodyJson.choices[0].message,
    usage,
    chatID,
    providerAddress,
    verified,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-top-up counter — persists across chatVerified calls, mapping
// provider address to the number of successful inference calls so far.
// Resets to 0 every time a top-up check is triggered.
// ─────────────────────────────────────────────────────────────────────────

const topUpCounterMap = new Map<string, number>();

// ─────────────────────────────────────────────────────────────────────────
// Streaming (kept for future use; no verification flow yet)
// ─────────────────────────────────────────────────────────────────────────

export async function chatStream(
  messages: ChatMessage[],
  tools?: ChatTool[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  return legacyClient.chat.completions.create({
    model: config.OG_COMPUTE_MODEL,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    stream: true,
  }) as unknown as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
}

// ─────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sanity check: confirm the broker / compute path is reachable. Call this
 * once at bot startup.
 */
export async function pingCompute(): Promise<{
  ok: boolean;
  model: string;
  baseUrl: string;
  providerAddress: string | null;
  verified: boolean | null;
}> {
  const base = {
    ok: false,
    model: config.OG_COMPUTE_MODEL,
    baseUrl: config.OG_COMPUTE_BASE_URL,
    providerAddress: getActiveProviderAddress(),
    verified: null as boolean | null,
  };

  try {
    const result = await chatVerified(
      [{ role: 'user', content: 'ping' }],
      undefined,
      { userContent: 'ping' },
    );
    return {
      ok: typeof result.message.content === 'string',
      model: config.OG_COMPUTE_MODEL,
      baseUrl: 'broker',
      providerAddress: result.providerAddress,
      verified: result.verified,
    };
  } catch {
    return base;
  }
}
