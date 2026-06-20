import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  getAllBalances,
  renameWallet,
} from '../wallet/walletService';
import { formatOG } from '../og/chain';

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
            createdAt: wallet.createdAt,
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
            createdAt: w.createdAt,
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

      default:
        return { success: false, error: `unknown tool: ${toolName}` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[toolExecutor] tool "${toolName}" failed:`, msg);
    return { success: false, error: msg };
  }
}
