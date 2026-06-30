import OpenAI from 'openai';
import { config } from '../config';
import { getActiveProviderAddress, getBroker, isReady } from './computeBroker';

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

  const broker = getBroker();

  // Resolve endpoint + model for this provider. Cache could help here later;
  // getServiceMetadata is on-chain read so keep it simple for now.
  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);

  // Sign the request with billing headers. content is used to compute the
  // estimated fee for the request.
  const headers = await broker.inference.getRequestHeaders(providerAddress, opts.userContent);

  // We use raw fetch (not the OpenAI SDK) because we need to read the
  // `ZG-Res-Key` response header. The OpenAI SDK doesn't expose response
  // headers on the parsed object.
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
  const fetchRes = await fetch(url, { method: 'POST', headers: fetchHeaders, body });

  if (!fetchRes.ok) {
    const text = await fetchRes.text().catch(() => '');
    throw new Error(
      `0G Compute provider returned ${fetchRes.status} ${fetchRes.statusText}: ${text.slice(0, 500)}`,
    );
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
      console.warn(`[compute] processResponse failed: ${(e as Error).message}`);
      verified = null;
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
