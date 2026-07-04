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
        'Create a wallet on 0G Chain. Optionally provide a name. Returns id, address, name, createdAt.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Optional name (max 32 chars). Extract from phrases like "called X". Defaults to "Wallet N".',
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
        'List all wallets with IDs, names, addresses, and creation dates.',
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
        'Get OG balance for one wallet or all wallets. Returns decimal strings.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description:
              'Optional wallet ID (8-char hex). Omit to return all wallet balances.',
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
        'Get the EVM address of a wallet. Call list_wallets first for the ID.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). Required.',
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
        'Rename a wallet (1-32 chars). Provide wallet ID and new name.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex) to rename.',
          },
          name: {
            type: 'string',
            description: 'The new name (1-32 characters).',
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
        'Search past interactions by text query or timeRange (today, yesterday, last7days, last30days).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Free-text search (case-insensitive).',
          },
          timeRange: {
            type: 'string',
            description:
              'Preset: "today", "yesterday", "last7days", "last30days", "all". Overrides fromTs/toTs.',
          },
          fromTs: {
            type: 'number',
            description:
              'Optional Unix-ms timestamp lower bound.',
          },
          toTs: {
            type: 'number',
            description:
              'Optional Unix-ms timestamp upper bound.',
          },
          limit: {
            type: 'number',
            description:
              'Max results. Default: 20.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_proofs',
      description:
        'Get recent TEE verification proofs with chatID, provider, and status.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max proofs. Defaults to 10.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description:
        'Full portfolio in USD across all wallets with per-wallet breakdown and grand total.',
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
      name: 'get_price',
      description:
        'Get USD price for any symbol or CoinGecko ID (OG, BTC, ethereum, etc.).',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description:
              'Token symbol (e.g. "OG", "BTC") or CoinGecko ID (e.g. "bitcoin"). Case-insensitive.',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_wallet_details',
      description:
        'Details for one wallet: name, address, balance, creation date, age. Call list_wallets first.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). Call list_wallets first.',
          },
        },
        required: ['walletId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_total_og',
      description:
        'Total OG across all wallets plus wallet count. Always sums everything.',
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
      name: 'get_wallet_timeline',
      description:
        'Wallets sorted by creation date ("oldest" or "newest").',
      parameters: {
        type: 'object',
        properties: {
          order: {
            type: 'string',
            description: '"oldest" (default) or "newest".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reveal_private_key',
      description:
        '⚠️ Reveal private key. Only when user explicitly asks. Warn user to keep it secret.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). Call list_wallets first.',
          },
        },
        required: ['walletId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reveal_recovery_phrase',
      description:
        '⚠️ Reveal BIP-39 seed phrase. Only when user explicitly asks. Warn user to store offline.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). Call list_wallets first.',
          },
        },
        required: ['walletId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_wallet',
      description:
        '⚠️ Permanently delete a wallet — IRREVERSIBLE. Warn user to back up key first.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex) to permanently delete.',
          },
        },
        required: ['walletId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transaction_stats',
      description:
        'On-chain and bot-recorded transaction counts, type breakdown, volume per token.',
      parameters: {
        type: 'object',
        properties: {
          timeRange: {
            type: 'string',
            description:
              'Optional time filter: "today", "yesterday", "last7days", "last30days", "all" (default).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dca_create',
      description:
        'Create a recurring DCA swap. Pairs: OG↔USDC/USDT/WOG. Schedules: daily, weekly, hourly.',
      parameters: {
        type: 'object',
        properties: {
          fromToken: {
            type: 'string',
            description: 'Input token: "OG", "WOG", "USDC", or "USDT".',
          },
          toToken: {
            type: 'string',
            description: 'Output token: "OG", "WOG", "USDC", or "USDT".',
          },
          amount: {
            type: 'string',
            description: 'Amount per execution (decimal string).',
          },
          schedule: {
            type: 'string',
            description: 'Frequency: "daily", "weekly", "hourly", "every N minutes/hours/days".',
          },
          walletId: {
            type: 'string',
            description: 'Optional wallet ID; defaults to active wallet.',
          },
        },
        required: ['fromToken', 'toToken', 'amount', 'schedule'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'alert_create',
      description:
        'One-shot price alert. Fires when condition is met, status flips to "fired". Supports any CoinGecko ID.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Token symbol (e.g. "OG", "BTC") or CoinGecko ID.',
          },
          operator: {
            type: 'string',
            description: 'Comparison: "<" (below), ">" (above), "<=", ">=".',
          },
          threshold: {
            type: 'number',
            description: 'USD price threshold (positive number).',
          },
        },
        required: ['symbol', 'operator', 'threshold'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_intents',
      description:
        'List all scheduled intents (DCAs + alerts) with summary, status, and next run.',
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
      name: 'cancel_intent',
      description:
        'Permanently cancel a scheduled intent. IRREVERSIBLE. Call list_intents first.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to permanently remove.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_intent',
      description:
        'Pause a scheduled intent. Reversible with resume_intent. Call list_intents first.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to pause.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_intent',
      description:
        'Resume a previously paused intent. Call list_intents first for the ID.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to resume.',
          },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'swap',
      description:
        'PREPARE a swap (user must tap Confirm). Supports wrap, unwrap, and DEX routes.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Input token: "OG", "WOG", or a 0x token contract.',
          },
          to: {
            type: 'string',
            description: 'Output token: "OG", "WOG", or a 0x token contract.',
          },
          amount: {
            type: 'string',
            description: 'Amount of the input token (decimal string).',
          },
          walletId: {
            type: 'string',
            description: 'Optional wallet ID; defaults to active wallet.',
          },
        },
        required: ['from', 'to', 'amount'],
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
