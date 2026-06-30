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
        "Create a new wallet for the user on 0G Chain. The user can have multiple named wallets, each with a custom name. Returns the new wallet's id, address, name, and createdAt (a pre-formatted UTC date string like \"June 21, 2026 at 7:04 PM UTC\" — use this verbatim when displaying the creation date). " +
        "Example user phrases: 'create me a wallet', 'make me a new wallet', 'generate a wallet', 'I need a wallet called savings', 'create another wallet', 'new wallet please', 'start a new wallet for me', 'give me a fresh wallet'. " +
        "If the user provides a name in their message (e.g. 'create a wallet called my savings'), pass it as the name parameter. Otherwise leave it empty for an auto-generated default.",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Optional name for the wallet (max 32 chars). If omitted, defaults to "Wallet N" where N is the next index. Detect if the user says something like "called X" or "named X" and extract X as the name.',
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
        "List all of the user's wallets with their IDs, names, addresses, and creation dates. Returns an array of { id, name, address, createdAt (pre-formatted UTC date string — use verbatim) }. " +
        "Example user phrases: 'show me my wallets', 'what wallets do I have', 'list my accounts', 'show all my wallets', 'what did I name my wallets', 'how many wallets do I have', 'display my wallets', 'list my wallets', 'show my wallet addresses'.",
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
        "Get the OG token balance for the user's wallet(s) on 0G Galileo testnet. If walletId is omitted, returns balances for ALL the user's wallets. Balances are in OG (native token), returned as decimal strings. " +
        "Example user phrases: 'how much OG do I have', 'check my balance', 'what's my wallet worth', 'show my funds', 'check my OG', 'what's my balance', 'do I have any OG', 'how many tokens do I have', 'show my OG balance', 'check all my wallets', 'how much is in each wallet'. " +
        "If the user mentions a specific wallet by name (e.g. 'check my savings balance'), resolve the name to a walletId and pass it. Otherwise omit walletId to return all.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description:
              'Optional specific wallet ID (8-char hex). If omitted, returns all wallet balances. Extract from user context if they mention a specific wallet by name.',
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
        "Get the EVM address (0x-prefixed 42-char hex) of a specific wallet by its ID. Use this when the user wants to receive funds, share their address, or see deposit details. " +
        "Example user phrases: 'what's my address', 'where do I receive funds', 'show my deposit address', 'what's my receive address', 'give me my wallet address', 'send me my wallet address', 'where can people send me OG', 'show my address for receiving', 'I need to receive tokens'. " +
        "IMPORTANT: This tool requires a walletId. First call list_wallets to find the wallet ID, then pass it here. " +
        "DIFFERENT from list_wallets: use this when the user wants a SPECIFIC wallet's address or wants to receive funds, not just a list of all wallets.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID (8-char hex string). Required — resolve from the user\'s wallet name if they mention one.',
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
        "Rename one of the user's wallets. The name must be 1–32 characters. Returns the new name on success. " +
        "Example user phrases: 'rename my wallet', 'change wallet name', 'rename savings to bills', 'call my wallet X', 'rename my first wallet to something else', 'change the name of my savings wallet to emergency', 'update my wallet name', 'set my wallet name to X'. " +
        "Extract the wallet ID from context (which wallet they mean) and the new name from their message.",
      parameters: {
        type: 'object',
        properties: {
          walletId: {
            type: 'string',
            description: 'The wallet ID to rename (8-char hex). Resolve from the user\'s message — they may refer to the wallet by its current name.',
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
        "Search the user's permanent memory on 0G Storage for past interactions — messages, tool calls, wallet activity, transactions. Use this whenever the user asks about past activity that is NOT about TEE proofs. " +
        "Example user phrases: 'what did I do today', 'what did I do yesterday', 'when did I create my savings wallet', 'what did I ask you last week', 'what did I do in the last hour', 'show me my recent activity', 'what happened earlier', 'show my chat history', 'recap my day', 'what transactions did I make'. " +
        "Supports free-text search (query) and convenient timeRange presets. " +
        "DIFFERENT from get_proofs: search_history is for general chat history and wallet activity. get_proofs is ONLY for TEE verification records.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional free-text to search for (case-insensitive substring match against message content). E.g., "savings", "create", "balance", "yesterday".',
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
  {
    type: 'function',
    function: {
      name: 'get_proofs',
      description:
        "Get the user's most recent TEE verification proofs — one per AI reply. Each proof records the chatID, the provider that served the response, and whether the TEE signature verified. Returns newest-first. " +
        "Example user phrases: 'show my proofs', 'what did you verify', 'any invalid signatures lately', 'did my last message get verified', 'show me my TEE proofs', 'verification history', 'which messages were verified in TEE', 'did that last reply actually run in a TEE', 'show me verified chat IDs'. " +
        "DIFFERENT from search_history: get_proofs is ONLY for TEE verification records. Do NOT use search_history for proof queries.",
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max number of proofs to return. Defaults to 10.',
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
        "Get the user's full portfolio across all wallets in USD value. Returns a per-wallet breakdown showing token, quantity, USD price, and USD value, plus a grand total. " +
        "Example user phrases: 'what's my portfolio worth', 'show me everything I own in USD', 'what's my total value', 'portfolio summary', 'how much are my wallets worth in dollars', 'what's my net worth in USD', 'grand total in dollars', 'show my full portfolio', 'what's my portfolio', 'how much money do I have across all wallets', 'total balance in USD'. " +
        "This computes OG prices via CoinGecko in real-time (cached for 60s). Returns USD values based on current market price.",
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
        "Get the current USD price for any cryptocurrency by symbol or CoinGecko ID. " +
        "Example user phrases: 'how much is OG in dollars', 'what's the price of OG', 'OG price', 'price of wrapped OG', 'how much is bitcoin', 'check crypto price', 'what's zero-gravity worth', 'how much is ethereum', 'price of USDC', 'show me the OG price', 'what's the current price'. " +
        "Known symbols: OG, 0G, WOG, USDC, USDT. For anything else, pass the raw CoinGecko ID (e.g. 'bitcoin', 'ethereum', 'solana'). " +
        "If the user types a dollar amount or asks about 'how much is X worth' in terms of price, use this tool. Do NOT use get_balance for price queries.",
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description:
              'Token symbol (e.g. "OG", "BTC", "ETH") OR raw CoinGecko ID (e.g. "bitcoin", "ethereum", "solana"). Case-insensitive. Try the symbol first; if not found as a known symbol, pass it as a CoinGecko ID.',
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
        "Get comprehensive details about ONE specific wallet by its ID: name, address, balance in OG, creation date, and how long ago it was created. " +
        "Example user phrases: 'tell me about my savings wallet', 'show me info about wallet X', 'what's my wallet details', 'give me the details of my first wallet', 'show my wallet info', 'what do you know about my main wallet'. " +
        "Unlike list_wallets which returns all wallets, this gives richer details about a single wallet including balance and age. " +
        "IMPORTANT: First call list_wallets to get the wallet ID, then pass it here.",
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
        "Get the total OG balance summed across ALL of the user's wallets, plus the number of wallets. " +
        "Example user phrases: 'how much OG do I have in total', 'total OG across all wallets', 'sum all my balances', 'how many wallets do I have and what's my total balance', 'total funds', 'my total OG', 'add up all my wallets'. " +
        "Returns: totalOG (string), walletCount (number), and a per-wallet breakdown. " +
        "Different from get_balance, this always sums everything into ONE total.",
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
        "Get wallets sorted by creation date — from oldest to newest (or newest to oldest). " +
        "Example user phrases: 'what's my oldest wallet', 'which wallet did I create first', 'show wallets by when I created them', 'oldest to newest', 'timeline of my wallets', 'show my wallets in order', 'when did I create each wallet', 'which is my most recent wallet'. " +
        "Returns the wallet list sorted chronologically plus each wallet's creation date and age. " +
        "Specify order='oldest' (default) or order='newest'.",
      parameters: {
        type: 'object',
        properties: {
          order: {
            type: 'string',
            description: '"oldest" (oldest first, default) or "newest" (newest first).',
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
        "⚠️ SECURITY-SENSITIVE: Reveal the PRIVATE KEY for a specific wallet. Only use this when the user EXPLICITLY asks to see their private key — never proactively offer it. " +
        "Example user phrases: 'show my private key', 'export my wallet', 'give me my private key', 'I need my private key for my savings wallet', 'reveal my key', 'let me see my private key'. " +
        "WARNING: The private key gives FULL control of the wallet. Advise the user to keep it secret and never share it. " +
        "IMPORTANT: First call list_wallets to find the wallet ID, then pass it here.",
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
      name: 'reveal_recovery_phrase',
      description:
        "⚠️ SECURITY-SENSITIVE: Reveal the BIP-39 recovery/seed phrase (mnemonic) for a specific wallet. Only use this when the user EXPLICITLY asks for their seed phrase or backup words — never proactively offer it. " +
        "Example user phrases: 'show my seed phrase', 'what's my recovery phrase', 'give me my backup words', 'show my mnemonic', 'I need to back up my wallet', 'what are my recovery words'. " +
        "WARNING: The seed phrase gives FULL control of the wallet — it can regenerate every address. Advise the user to store it OFFLINE and never share it. " +
        "Returns null if the wallet was created before seed phrase storage was added. " +
        "IMPORTANT: First call list_wallets to find the wallet ID, then pass it here.",
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
      name: 'delete_wallet',
      description:
        "⚠️ DESTRUCTIVE: Permanently delete a wallet from the user's account. The wallet and its private key are removed from storage and cannot be recovered. " +
        "Example user phrases: 'delete my wallet', 'remove this wallet', 'delete my savings wallet', 'get rid of wallet X', 'I want to remove a wallet', 'delete wallet please'. " +
        "WARNING: This is IRREVERSIBLE — the wallet and all its funds on this bot will be lost. Before deleting, warn the user and advise them to back up their private key first. " +
        "IMPORTANT: First call list_wallets to find the wallet ID, then confirm with the user before deleting.",
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
