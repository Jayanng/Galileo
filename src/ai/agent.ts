import { chat, type ChatMessage } from '../og/compute';
import { toolDefinitions } from './tools';
import { buildSystemPrompt } from './systemPrompt';
import { executeTool } from './toolExecutor';
import { recordToolCall } from './memory';

/**
 * Maximum number of LLM round-trips per user message.
 *
 * Each iteration = one chat completion call. If the LLM keeps requesting
 * tools without producing a final answer, we bail out after this many
 * iterations and return a graceful fallback.
 */
const MAX_ITERATIONS = 5;

export interface AgentRunResult {
  /** Final text reply to send back to the user. */
  reply: string;
  /** Updated conversation history (NOT including the system prompt). */
  updatedHistory: ChatMessage[];
  /** Number of LLM round-trips used. Useful for debugging. */
  iterations: number;
  /** Whether the run completed normally or hit the iteration cap. */
  status: 'complete' | 'max_iterations';
}

/**
 * Run the AI agent loop for a single user message.
 *
 * @param userId              Telegram user ID (string)
 * @param userMessage         The user's new message text
 * @param conversationHistory Prior messages in this conversation (NOT including system prompt)
 * @param extraContext        Optional retrieved context from 0G Storage (built into system prompt)
 * @param memoryContext       Optional recent memory entries (injected as a separate system message)
 * @returns                   AgentRunResult with the final reply and updated history
 */
export async function runAgent(
  userId: string,
  userMessage: string,
  conversationHistory: ChatMessage[] = [],
  extraContext?: string,
  memoryContext?: string,
): Promise<AgentRunResult> {
  const systemMessage: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt(extraContext),
  };

  const messages: ChatMessage[] = [
    systemMessage,
    ...(memoryContext
      ? [
          {
            role: 'system' as const,
            content: `--- RECENT USER ACTIVITY (from your permanent memory on 0G Storage) ---\nThe following are this user's recent interactions. If the user asks about past activity, USE THIS DATA to answer — do not say you have no record.\n\n${memoryContext}\n--- END RECENT ACTIVITY ---`,
          },
        ]
      : []),
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const { message } = await chat(messages, toolDefinitions);

    // Case A: LLM wants to call one or more tools
    if (message.tool_calls && message.tool_calls.length > 0) {
      // Append the assistant's tool-call message to the conversation
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls,
      });

      // Execute each tool call and append the results
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          // LLM returned malformed JSON args — pass empty object, executor will fail gracefully
          console.warn(`[agent] malformed tool args for "${toolName}":`, toolCall.function.arguments);
        }

        console.log(`[agent] tool call: ${toolName}(${JSON.stringify(parsedArgs)})`);
        const result = await executeTool(userId, toolName, parsedArgs);

        // F1: persist tool call to 0G Storage (best-effort, never throws)
        await recordToolCall(userId, toolName, parsedArgs, result);

        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }

      // Loop back: LLM will see the tool results and either call more tools or produce final text
      continue;
    }

    // Case B: LLM produced final text — we're done
    const finalReply = message.content ?? '(no response)';
    return {
      reply: finalReply,
      iterations: i + 1,
      status: 'complete',
      updatedHistory: [
        ...conversationHistory,
        { role: 'user', content: userMessage },
        { role: 'assistant', content: finalReply },
      ],
    };
  }

  // Hit the iteration cap — return a graceful fallback
  console.warn(`[agent] hit MAX_ITERATIONS (${MAX_ITERATIONS}) for user ${userId}`);
  return {
    reply:
      "I'm having trouble completing that request — it required too many steps. Could you try a simpler version, or use /help to see what I can do?",
    iterations: MAX_ITERATIONS,
    status: 'max_iterations',
    updatedHistory: [
      ...conversationHistory,
      { role: 'user', content: userMessage },
      {
        role: 'assistant',
        content:
          "I'm having trouble completing that request — it required too many steps.",
      },
    ],
  };
}
