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
// ─────────────────────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.ok) return response;

    // Don't retry 400-499 except 429 (rate limit)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      return response; // caller will throw with the actual status
    }

    if (attempt < maxRetries - 1) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.warn(
        `[compute] retry ${attempt + 1}/${maxRetries} after ${delay}ms (status ${response.status})`,
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
// Verified path: official 0G Compute SDK
// ─────────────────────────────────────────────────────────────────────────

interface VerifiedCallOptions {
  /** User-supplied text. Required by getRequestHeaders for fee calculation. */
  userContent?: string;
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

  // Acquire concurrency slot before any SDK/network calls
  await acquireSlot();
  try {
    return await doChatVerified(messages, tools, opts, providerAddress);
  } finally {
    releaseSlot();
  }
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
