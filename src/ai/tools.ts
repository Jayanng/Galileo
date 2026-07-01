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
        'Create a new wallet on 0G Chain. Optionally provide a name. ' +
        'Examples: "create me a wallet", "make a wallet called savings". ' +
        'Returns id, address, name, and createdAt date.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Optional wallet name (max 32 chars). Extract from phrases like "called X" or "named X". Defaults to "Wallet N".',
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
        'List all wallets with IDs, names, addresses, and creation dates. ' +
        'Examples: "show my wallets", "list my accounts", "what wallets do I have".',
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
        'Get OG token balance. Omit walletId to check all wallets. ' +
        'Examples: "check my balance", "how much OG do I have", ' +
        '"what\'s in my savings wallet". Returns decimal strings.',
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
        'Get the EVM address (0x + 40 hex) of a specific wallet. ' +
        'Call list_wallets first to find the wallet ID. ' +
        'Examples: "what\'s my address", "where do I receive funds".',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). Required — resolve from the user\'s wallet name.',
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
        'Rename a wallet (1–32 chars). Extract wallet ID from context and new name from message. ' +
        'Examples: "rename savings to bills", "call my wallet X". Returns new name.',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID to rename (8-char hex). Resolve from the wallet\'s current name.',
          },
          name: {
            type: 'string',
            description: 'The new name (1–32 characters). Extract from the user\'s message.',
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
        'Search permanent memory for past interactions — messages, wallet activity, transactions. ' +
        'Supports free-text query and timeRange presets (today, yesterday, last7days, last30days). ' +
        'Examples: "what did I do yesterday", "show my transactions". ' +
        'DO NOT use for TEE proofs — use get_proofs instead.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional free-text search (case-insensitive). E.g. "savings", "send", "yesterday".',
          },
          timeRange: {
            type: 'string',
            description:
              'Optional preset: "today" (since midnight UTC), "yesterday", "last7days", "last30days", "all". Overrides fromTs/toTs.',
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
        'Get recent TEE verification proofs. Each proof records chatID, provider, and verification status. ' +
        'Examples: "show my proofs", "verification history", "did my last message get verified". ' +
        'DO NOT use search_history for proof queries.',
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
        'Get full portfolio in USD across all wallets. Returns per-wallet breakdown and grand total. ' +
        'Examples: "what\'s my portfolio worth", "show my total value", "net worth in USD". ' +
        'CoinGecko pricing cached for 60s.',
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
        'Get USD price for any crypto by symbol or CoinGecko ID. ' +
        'Known: OG, 0G, WOG, USDC, USDT. Others pass raw ID (bitcoin, ethereum). ' +
        'Examples: "how much is OG", "bitcoin price", "what\'s ethereum worth".',
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
        'Get details about ONE wallet: name, address, balance, creation date, age. ' +
        'Call list_wallets first for the wallet ID. ' +
        'Examples: "tell me about my savings wallet", "wallet info".',
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex). First call list_wallets to get this.',
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
        'Get total OG across all wallets plus wallet count. ' +
        'Examples: "total OG across all wallets", "sum all balances", "how many wallets". ' +
        'Different from get_balance — always sums everything.',
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
        'Get wallets sorted by creation date. Order: "oldest" (default) or "newest". ' +
        'Examples: "what\'s my oldest wallet", "when did I create each wallet", "show wallets in order".',
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
        '⚠️ SECURITY: Reveal private key. Only use when user EXPLICITLY asks. ' +
        'Call list_wallets first for the wallet ID. ' +
        'Examples: "show my private key", "export wallet". Warn user to keep it secret.',
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
        '⚠️ SECURITY: Reveal BIP-39 seed phrase. Only when user EXPLICITLY asks. ' +
        'Call list_wallets first for the wallet ID. ' +
        'Examples: "show my seed phrase", "recovery words". Warn user to store offline. Returns null if not available.',
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
        '⚠️ DESTRUCTIVE: Permanently delete a wallet — IRREVERSIBLE. ' +
        'Warn user and advise backing up private key first. ' +
        'Call list_wallets first for the wallet ID. ' +
        'Examples: "delete my savings wallet", "remove wallet".',
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
        'Get transaction totals: on-chain count, bot-recorded count, type breakdown, volume per token. ' +
        'For details about specific transactions, call search_history afterward. ' +
        'Examples: "how many transactions", "total volume", "my activity totals".',
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
        'Create a recurring DCA swap on a schedule. Supported pairs: OG↔USDC, OG↔USDT, OG↔WOG. ' +
        'Schedules: daily, weekly, hourly, "every N minutes/hours/days". ' +
        'Examples: "dca 1 OG into USDC weekly", "swap 0.5 OG daily". ' +
        'No funds move at creation — only on first execution.',
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
            description: 'Amount of the input token per execution (decimal string).',
          },
          schedule: {
            type: 'string',
            description: 'Frequency: "daily", "weekly", "hourly", "every 6 hours", "every Monday".',
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
        'Create a one-shot price alert. Fires once when condition is met, then status flips to "fired". ' +
        'Supports OG, WOG, USDC, USDT, or any CoinGecko ID. ' +
        'Examples: "alert me if OG drops below $1", "notify when bitcoin > $100k".',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Token symbol (e.g. "OG", "BTC") or CoinGecko ID. Case-insensitive.',
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
        'List all scheduled intents (DCAs + alerts) with id, type, summary, status, schedule, next run. ' +
        'Examples: "show my intents", "what DCAs are active", "list my alerts". ' +
        'For interactive management with buttons, point users to /intents.',
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
        'Permanently cancel (delete) a scheduled intent. IRREVERSIBLE. ' +
        'Call list_intents first to find the ID. ' +
        'Examples: "cancel my weekly DCA", "stop that alert".',
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
        'Pause a scheduled intent without deleting it. Reversible with resume_intent. ' +
        'Call list_intents first for the ID. ' +
        'Examples: "pause my DCA", "hold off on weekly DCA".',
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
        'Resume a previously paused intent. Call list_intents first for the ID. ' +
        'Examples: "resume my DCA", "unpause my weekly DCA".',
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
        'PREPARE a token swap (does NOT execute — user must tap Confirm). ' +
        'Supports wrap (OG→WOG), unwrap (WOG→OG) and DEX swaps. ' +
        'Examples: swap(from="OG", to="WOG", amount="5"), swap(from="WOG", to="OG", amount="2.5"). ' +
        'Do NOT substitute tokens — relay errors honestly.',
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
