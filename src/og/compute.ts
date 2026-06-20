import OpenAI from 'openai';
import { config } from '../config';

/**
 * 0G Compute Router client.
 *
 * The Router is OpenAI-API-compatible, so we use the official `openai` SDK
 * pointed at the 0G Compute Router endpoint. Every chat completion call
 * runs on decentralized inference providers (TEE-backed) and is billed
 * against our on-chain 0G token deposit.
 *
 * Docs: https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview
 */

export const computeClient = new OpenAI({
  baseURL: config.OG_COMPUTE_BASE_URL,
  apiKey: config.OG_COMPUTE_API_KEY,
  timeout: 60 * 1000, // 60 seconds
  maxRetries: 0,      // fail fast so we can surface errors promptly
});

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ChatResult {
  message: OpenAI.Chat.Completions.ChatCompletionMessage;
  usage?: OpenAI.Completions.CompletionUsage;
}

/**
 * Single-shot chat completion (no streaming).
 *
 * Pass `tools` to enable function-calling. The returned message may contain
 * either `content` (final text) or `tool_calls` (the LLM wants to call tools).
 */
export async function chat(
  messages: ChatMessage[],
  tools?: ChatTool[],
): Promise<ChatResult> {
  const response = await computeClient.chat.completions.create({
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

/**
 * Streaming chat completion. Returns an async iterable of chunks.
 * Use this for long responses (e.g., portfolio advisor narratives in F3).
 *
 * Example:
 *   const stream = await chatStream(messages, tools);
 *   for await (const chunk of stream) {
 *     const delta = chunk.choices[0]?.delta?.content ?? '';
 *     if (delta) process.stdout.write(delta);
 *   }
 */
export async function chatStream(
  messages: ChatMessage[],
  tools?: ChatTool[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  return computeClient.chat.completions.create({
    model: config.OG_COMPUTE_MODEL,
    messages,
    tools: tools && tools.length > 0 ? tools : undefined,
    tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
    stream: true,
  }) as unknown as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
}

/**
 * Sanity check: confirm the client is configured and reachable.
 * Call this once at bot startup.
 */
export async function pingCompute(): Promise<{ ok: boolean; model: string; baseUrl: string }> {
  try {
    const result = await chat(
      [{ role: 'user', content: 'ping' }],
      undefined,
    );
    return {
      ok: typeof result.message.content === 'string',
      model: config.OG_COMPUTE_MODEL,
      baseUrl: config.OG_COMPUTE_BASE_URL,
    };
  } catch (e) {
    return {
      ok: false,
      model: config.OG_COMPUTE_MODEL,
      baseUrl: config.OG_COMPUTE_BASE_URL,
    };
  }
}
