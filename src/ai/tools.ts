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
        "Example user phrases: 'what did I do today', 'what did I do yesterday', 'when did I create my savings wallet', 'what did I ask you last week', 'what did I do in the last hour', 'show me my recent activity', 'what happened earlier', 'show my chat history', 'recap my day', 'what transactions did I make', 'which wallet did I send to', 'where did I send my OG', 'show me my transactions'. " +
        "Supports free-text search (query) and convenient timeRange presets. " +
        "DIFFERENT from get_proofs: search_history is for general chat history and wallet activity. get_proofs is ONLY for TEE verification records. " +
        "If the user asks about 'which wallet did I send to?' or 'who did I send OG to?', call search_history(query=\"send\") — NEVER answer with get_balance (which only shows current balances, not past sends).",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Optional free-text to search for (case-insensitive substring match against message content). E.g., "savings", "create", "balance", "yesterday", "send", "receive".',
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
  {
    type: 'function',
    function: {
      name: 'transaction_stats',
      description:
        "Get the user's transaction totals. Use this whenever the user asks how many transactions they've done, their total transaction count, total volume, how much they've sent/swapped, or 'my activity totals'. Returns: onChainTxCount (true count of on-chain transactions sent across all their wallets), recordedCount (transactions this bot has logged), byType (breakdown like { send: 3, swap: 2 }), and volumeByUnit (total amount transacted per token, e.g. { OG: \"1.6\", USDC: \"200\" }). Volume is only known for transactions done through this bot. " +
        "IMPORTANT: onChainTxCount is a raw number only — it has NO details about destinations, amounts, or wallet names. If the user asks 'what are those transactions?' or 'show me the details' after you report a count, you MUST call search_history to retrieve the actual records.",
      parameters: {
        type: 'object',
        properties: {
          timeRange: {
            type: 'string',
            description:
              'Optional preset to limit the recorded stats by time: "today", "yesterday", "last7days", "last30days", or "all" (default). Affects recordedCount/byType/volumeByUnit; onChainTxCount is always all-time.',
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
        "Create a DCA (Dollar-Cost Averaging) intent: a recurring swap of a fixed amount on a schedule. The user's active wallet (or the specified walletId) is used. Supported schedules: 'daily', 'weekly', 'hourly', 'every N minutes/hours/days', 'every Monday/Tuesday/...'. Supported token pairs: OG<->USDC, OG<->USDT, OG<->WOG (wrap/unwrap). The intent runs automatically every 30 seconds' worth of polling on the bot's in-process worker, so a DCA fires within ~60s of its scheduled time. The intent persists across bot restarts on 0G Storage. " +
        "Example user phrases: 'dca 1 OG into USDC weekly', 'dollar-cost average 0.5 OG into USDT daily', 'swap 0.1 OG for USDC every 6 hours', 'DCA me into WOG hourly'. " +
        "Returns the created intent with id, summary, status, nextRunAt — show these to the user so they can manage it via /intents. " +
        "Note: No funds move at creation — only on the first scheduled execution.",
      parameters: {
        type: 'object',
        properties: {
          fromToken: {
            type: 'string',
            description: 'Input token: "OG" (native), "WOG", "USDC", or "USDT".',
          },
          toToken: {
            type: 'string',
            description: 'Output token: "OG", "WOG", "USDC", or "USDT".',
          },
          amount: {
            type: 'string',
            description: 'Amount of the INPUT token per execution, as a decimal string (e.g. "1", "0.25").',
          },
          schedule: {
            type: 'string',
            description: 'How often to execute. Examples: "daily", "weekly", "hourly", "every 6 hours", "every 30 minutes", "every Monday".',
          },
          walletId: {
            type: 'string',
            description: 'Optional wallet id (8-char hex); defaults to the user\'s active wallet.',
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
        "Create a price-alert intent: send the user a Telegram message when a token crosses a USD threshold. ONE-SHOT — fires once when the condition is met, then status flips to 'fired'. Supported symbols: OG, WOG, USDC, USDT, or any CoinGecko ID (e.g. 'bitcoin', 'ethereum', 'solana'). " +
        "Example user phrases: 'alert me if OG drops below $1', 'notify me when bitcoin goes above $100k', 'tell me if ETH falls under $3000', 'alert me OG below 2'. " +
        "Returns the created alert with id, summary, status — show these so the user can manage it via /intents.",
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Token symbol (e.g. "OG", "BTC", "ETH") or CoinGecko ID. Case-insensitive.',
          },
          operator: {
            type: 'string',
            description: 'Comparison operator: "<" (below), ">" (above), "<=" (at or below), ">=" (at or above).',
          },
          threshold: {
            type: 'number',
            description: 'USD price threshold as a positive number (e.g. 1, 100000, 0.5).',
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
        "List all of the user's scheduled intents (DCAs + alerts) with their id, type, summary, status (active/paused/fired), schedule, nextRunAt, lastExecutedAt. Use this whenever the user asks 'what DCAs do I have', 'show my alerts', 'what intents are running', 'list my schedules'. " +
        "Example user phrases: 'show my intents', 'what DCAs are active', 'list my alerts', 'what schedules do I have running'. " +
        "DIFFERENT from /intents command: list_intents returns data; /intents renders an interactive list with Cancel/Pause buttons.",
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
        "Permanently cancel (delete) a scheduled intent by id. Once cancelled, the intent is removed and will not fire again. Use list_intents first to find the id. " +
        "Example user phrases: 'cancel my weekly DCA', 'stop that alert', 'delete my DCA id abc12345'. " +
        "WARNING: cancellation is irreversible. Confirm with the user for non-trivial cases.",
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to permanently remove. Resolve from list_intents.',
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
        "Pause a scheduled intent by id without deleting it. While paused, the worker skips it. Use resume_intent to restart. Use list_intents first to find the id. " +
        "Example user phrases: 'pause my DCA', 'pause that alert', 'hold off on my weekly DCA'. " +
        "Pausing is reversible — the intent can be resumed later with resume_intent.",
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to pause. Resolve from list_intents.',
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
        "Resume a previously paused intent by id. Use list_intents first to find the id. " +
        "Example user phrases: 'resume my DCA', 'unpause that alert', 'start my weekly DCA again'.",
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The intent id (8-char hex) to resume. Resolve from list_intents.',
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
        "PREPARE a token swap from the user's active wallet on 0G Galileo. This does NOT execute — it stages the swap and the user must tap a Confirm button afterward. Supports wrap (OG → WOG) and unwrap (WOG → OG) today; token-to-token needs a configured DEX. After calling this, tell the user the swap is prepared and ask them to tap Confirm. " +
        "Example: swap(from='OG', to='WOG', amount='5') or swap(from='WOG', to='OG', amount='2.5') or swap(from='OG', to='USDC', amount='1'). " +
        "CRITICAL: NEVER substitute a different token than the user asked for — do NOT turn a 'USDC' or 'USDT' request into a WOG wrap. If the swap tool returns an error that the token/DEX isn't available, relay that honestly. For a reliable guided flow, you can always point users to the 🔄 Swap button on /start, or the /wrap, /unwrap, and /swap commands.",
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Input token: "OG" (native), "WOG", or a 0x token contract address.',
          },
          to: {
            type: 'string',
            description: 'Output token: "OG", "WOG", or a 0x token contract address.',
          },
          amount: {
            type: 'string',
            description: 'Amount of the INPUT token, as a decimal string (e.g. "5", "0.25").',
          },
          walletId: {
            type: 'string',
            description: 'Optional wallet id; defaults to the user\'s active wallet.',
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
