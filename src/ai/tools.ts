import type { ChatTool } from '../og/compute';

/**
 * Tool definitions for the 0G Memory Wallet LLM agent.
 *
 * Each tool maps to an existing function in src/wallet/walletService.ts.
 * The LLM picks tools via OpenAI-compatible function-calling, and our
 * agent loop (src/ai/agent.ts) dispatches the call to the matching
 * function in src/ai/toolExecutor.ts.
 *
 * IMPORTANT: Wallet IDs are random 8-char hex strings (from newWalletId).
 * Addresses are 42-char EVM addresses (0x + 40 hex).
 * Amounts are always strings (BigInt-serializable), never JS numbers.
 */

export const toolDefinitions: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_wallet',
      description:
        "Create a new wallet for the user on 0G Chain. The user can have multiple named wallets. Returns the new wallet's id, address, name, and createdAt (a pre-formatted UTC date string like \"June 21, 2026 at 7:04 PM UTC\" — use this verbatim when displaying the creation date).",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Optional name for the wallet (max 32 chars). If omitted, defaults to "Wallet N" where N is the next index.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_wallets',
      description:
        "List all of the user's wallets. Returns an array of { id, name, address, createdAt (a pre-formatted UTC date string like \"June 21, 2026 at 7:04 PM UTC\" — use this verbatim when displaying the creation date) }.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description:
        "Get the OG token balance for the user's wallet(s) on 0G Galileo testnet. If walletId is omitted, returns balances for ALL the user's wallets. Balances are in OG (native token), returned as decimal strings.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description:
              'Optional specific wallet ID. If omitted, returns all wallet balances.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_wallet_address',
      description:
        "Get the EVM address of a specific wallet by its ID. Use this when the user wants to receive funds or share their address.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex string from list_wallets).',
          },
        },
        required: ['walletId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_wallet',
      description:
        "Rename one of the user's wallets. The name must be 1–32 characters.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID to rename.',
          },
          name: {
            type: 'string',
            description: 'The new name (1–32 characters).',
          },
        },
        required: ['walletId', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_history',
      description:
        "Search the user's permanent memory on 0G Storage for past interactions. Use this whenever the user asks about past activity (e.g., 'what did I do today?', 'what did I do yesterday?', 'when did I create my savings wallet?', 'what did I ask you last week?', 'what did I do in the last hour?'). Supports free-text search and convenient timeRange presets.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional free-text to search for (case-insensitive substring match against message content). E.g., "savings", "create", "balance".',
          },
          timeRange: {
            type: 'string',
            description:
              'Optional convenience preset for common time ranges. Instead of computing fromTs/toTs yourself, use one of: "today" (since midnight UTC today), "yesterday" (previous 24 hours), "last7days" (7 days ago to now), "last30days" (30 days ago to now), "all" (no time filter). If timeRange is provided, fromTs/toTs are ignored.',
          },
          fromTs: {
            type: 'number',
            description:
              'Optional Unix-ms timestamp lower bound (inclusive). Use this UNLESS you are using the timeRange parameter. E.g., Date.now() - 86400000 for "last 24 hours".',
          },
          toTs: {
            type: 'number',
            description:
              'Optional Unix-ms timestamp upper bound (inclusive). Use this UNLESS you are using the timeRange parameter. E.g., Date.now() for "up to now".',
          },
          limit: {
            type: 'number',
            description:
              'Max number of results to return. Defaults to 20.',
          },
        },
        required: [],
      },
    },
  },
];

/**
 * Quick lookup: tool name → tool definition. Used by the agent for
 * introspection and validation.
 */
export const toolMap: Record<string, ChatTool> = Object.fromEntries(
  toolDefinitions.map((t) => [t.function.name, t]),
);

export function getToolNames(): string[] {
  return toolDefinitions.map((t) => t.function.name);
}
