import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  getAllBalances,
  renameWallet,
} from '../wallet/walletService';
import { formatOG } from '../og/chain';
import { search } from './memory';
import { prepareSwap } from '../swap/swapService';

/**
 * Tool execution result. Always JSON-serializable (no BigInts).
 *
 * On success: { success: true, data: ... }
 * On error:   { success: false, error: "message" }
 */
export type ToolResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

/**
 * Dispatch an LLM tool call to the matching walletService function.
 *
 * @param userId   Telegram user ID (string)
 * @param toolName One of: create_wallet, list_wallets, get_balance,
 *                 get_wallet_address, rename_wallet
 * @param args     Parsed JSON arguments from the LLM
 * @returns        JSON-serializable result (safe to feed back to the LLM
 *                 as a tool response message)
 */
export async function executeTool(
  userId: string,
  toolName: string,
  args: Record<string, any>,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'create_wallet': {
        const name = typeof args.name === 'string' ? args.name : undefined;
        const wallet = await createWallet(userId, name);
        return {
          success: true,
          data: {
            id: wallet.id,
            name: wallet.name,
            address: wallet.address,
            createdAt: new Date(wallet.createdAt).toLocaleString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'long',
              timeStyle: 'short',
            }) + ' UTC',
          },
        };
      }

      case 'list_wallets': {
        const wallets = await listWallets(userId);
        return {
          success: true,
          data: wallets.map((w) => ({
            id: w.id,
            name: w.name,
            address: w.address,
            createdAt: new Date(w.createdAt).toLocaleString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'long',
              timeStyle: 'short',
            }) + ' UTC',
          })),
        };
      }

      case 'get_balance': {
        if (args.walletId) {
          const bal = await getWalletBalance(userId, String(args.walletId));
          if (bal === null) {
            return { success: false, error: 'wallet not found' };
          }
          return {
            success: true,
            data: { balance: formatOG(bal), unit: 'OG' },
          };
        }
        // No walletId → return all balances
        const all = await getAllBalances(userId);
        return {
          success: true,
          data: all.map((w) => ({
            id: w.id,
            name: w.name,
            address: w.address,
            balance: formatOG(w.balance),
            unit: 'OG',
          })),
        };
      }

      case 'get_wallet_address': {
        if (!args.walletId) {
          return { success: false, error: 'walletId is required' };
        }
        const w = await getWallet(userId, String(args.walletId));
        if (!w) {
          return { success: false, error: 'wallet not found' };
        }
        return {
          success: true,
          data: { id: w.id, name: w.name, address: w.address },
        };
      }

      case 'rename_wallet': {
        if (!args.walletId || !args.name) {
          return { success: false, error: 'walletId and name are required' };
        }
        const name = String(args.name).trim().slice(0, 32);
        if (!name) {
          return { success: false, error: 'name cannot be empty' };
        }
        await renameWallet(userId, String(args.walletId), name);
        return { success: true, data: { renamed: true, name } };
      }

      case 'search_history': {
        const query = typeof args.query === 'string' ? args.query : undefined;
        const timeRange = typeof args.timeRange === 'string' ? args.timeRange : undefined;
        const limit = typeof args.limit === 'number' ? args.limit : undefined;

        // Convert timeRange preset to fromTs/toTs
        let fromTs: number | undefined = typeof args.fromTs === 'number' ? args.fromTs : undefined;
        let toTs: number | undefined = typeof args.toTs === 'number' ? args.toTs : undefined;

        if (timeRange) {
          // timeRange takes precedence over fromTs/toTs
          const now = Date.now();
          switch (timeRange) {
            case 'today': {
              // Midnight UTC today
              const d = new Date();
              fromTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
              toTs = now;
              break;
            }
            case 'yesterday':
              fromTs = now - 86400000;
              toTs = now;
              break;
            case 'last7days':
              fromTs = now - 7 * 86400000;
              toTs = now;
              break;
            case 'last30days':
              fromTs = now - 30 * 86400000;
              toTs = now;
              break;
            case 'all':
              fromTs = undefined;
              toTs = undefined;
              break;
            default:
              // unknown timeRange, ignore
              break;
          }
        }

        const results = await search(userId, query, fromTs, toTs, limit);
        console.log(`[toolExecutor] search_history query="${query ?? ''}" timeRange="${timeRange ?? ''}" results=${results.length}`);
        return {
          success: true,
          data: {
            count: results.length,
            results,
          },
        };
      }

      case 'swap': {
        const res = await prepareSwap(userId, {
          from: String(args.from ?? ''),
          to: String(args.to ?? ''),
          amount: String(args.amount ?? ''),
          walletId: args.walletId ? String(args.walletId) : undefined,
        });
        if (!res.ok) return { success: false, error: res.error };
        return {
          success: true,
          data: { prepared: true, summary: res.summary, note: 'Tell the user to tap Confirm to execute.' },
        };
      }

      default:
        return { success: false, error: `unknown tool: ${toolName}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[toolExecutor] tool "${toolName}" failed:`, msg);
    return { success: false, error: msg };
  }
}
