import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  getAllBalances,
  renameWallet,
  getWalletSecrets,
  deleteWallet,
} from '../wallet/walletService';
import { formatOG } from '../og/chain';
import { search, getRecentProofs } from './memory';
import { buildPortfolio } from '../og/portfolio';
import { getPriceUSD, getPriceByCoinGeckoId, KNOWN_SYMBOLS } from '../og/prices';

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
 *                 get_wallet_address, rename_wallet, search_history,
 *                 get_proofs, get_portfolio, get_price
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

      case 'get_proofs': {
        const limit = typeof args.limit === 'number' ? args.limit : 10;
        const proofs = await getRecentProofs(userId, limit);
        console.log(`[toolExecutor] get_proofs limit=${limit} results=${proofs.length}`);
        return {
          success: true,
          data: {
            count: proofs.length,
            proofs: proofs.map((p) => ({
              chatID: p.chatID,
              providerAddress: p.providerAddress,
              verified: p.verified,
              ts: p.ts,
            })),
          },
        };
      }

      case 'get_portfolio': {
        const portfolio = await buildPortfolio(userId);
        console.log(`[toolExecutor] get_portfolio lines=${portfolio.lines.length} grandTotal=${portfolio.grandTotalFormatted}`);
        return {
          success: true,
          data: {
            lines: portfolio.lines.map((l) => ({
              walletName: l.walletName,
              symbol: l.symbol,
              quantity: l.quantity,
              usdPrice: l.usdPrice,
              usdValue: l.usdValue,
            })),
            grandTotalUsd: portfolio.grandTotalUsd,
            grandTotalFormatted: portfolio.grandTotalFormatted,
          },
        };
      }

      case 'get_price': {
        const input = String(args.symbol ?? '').toUpperCase().trim();
        if (!input) {
          return { success: false, error: 'symbol is required' };
        }

        // Try as known symbol first
        let price = await getPriceUSD(input);
        let displayName = input;

        // If not found, try as raw CoinGecko ID
        if (price === null) {
          price = await getPriceByCoinGeckoId(args.symbol.toLowerCase().trim());
          displayName = args.symbol.trim();
        }

        if (price === null) {
          return {
            success: false,
            error: `Could not find a price for "${input}". Known symbols: ${KNOWN_SYMBOLS.join(', ')}`,
          };
        }

        return {
          success: true,
          data: {
            symbol: displayName,
            priceUsd: price,
            formatted: price < 0.01 ? `$${price.toFixed(6)}` : price < 1 ? `$${price.toFixed(4)}` : `$${price.toFixed(2)}`,
          },
        };
      }

      case 'get_wallet_details': {
        if (!args.walletId) {
          return { success: false, error: 'walletId is required' };
        }
        const w = await getWallet(userId, String(args.walletId));
        if (!w) {
          return { success: false, error: 'wallet not found' };
        }
        const bal = await getWalletBalance(userId, String(args.walletId));
        const ageMs = Date.now() - w.createdAt;
        const ageDays = Math.floor(ageMs / 86400000);
        const ageStr = ageDays < 1 ? 'today' : ageDays < 30 ? `${ageDays} day(s) ago` : `${Math.floor(ageDays / 30)} month(s) ago`;
        return {
          success: true,
          data: {
            id: w.id,
            name: w.name,
            address: w.address,
            balanceOG: bal !== null ? formatOG(bal) : '—',
            createdAt: new Date(w.createdAt).toLocaleString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'long',
              timeStyle: 'short',
            }) + ' UTC',
            age: ageStr,
          },
        };
      }

      case 'get_total_og': {
        const all = await getAllBalances(userId);
        let totalWei = 0n;
        for (const w of all) totalWei += w.balance;
        return {
          success: true,
          data: {
            walletCount: all.length,
            totalOG: formatOG(totalWei),
            breakdown: all.map((w) => ({
              name: w.name,
              balance: formatOG(w.balance),
            })),
          },
        };
      }

      case 'get_wallet_timeline': {
        const wallets = await listWallets(userId);
        const order = String(args.order ?? 'oldest').toLowerCase();
        const sorted = [...wallets].sort((a, b) =>
          order === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt,
        );
        return {
          success: true,
          data: {
            count: sorted.length,
            order: order === 'newest' ? 'newest first' : 'oldest first',
            wallets: sorted.map((w) => ({
              id: w.id,
              name: w.name,
              address: w.address,
              createdAt: new Date(w.createdAt).toLocaleString('en-US', {
                timeZone: 'UTC',
                dateStyle: 'long',
                timeStyle: 'short',
              }) + ' UTC',
            })),
          },
        };
      }

      case 'reveal_private_key': {
        if (!args.walletId) {
          return { success: false, error: 'walletId is required' };
        }
        const sec = await getWalletSecrets(userId, String(args.walletId));
        if (!sec) {
          return { success: false, error: 'wallet not found' };
        }
        console.log(`[toolExecutor] reveal_private_key for wallet=${sec.name} (${sec.address})`);
        return {
          success: true,
          data: {
            name: sec.name,
            address: sec.address,
            privateKey: sec.privateKey,
            securityWarning: 'Keep this private key secret! Anyone with it has full control of the wallet. Never share it online.',
          },
        };
      }

      case 'reveal_recovery_phrase': {
        if (!args.walletId) {
          return { success: false, error: 'walletId is required' };
        }
        const sec = await getWalletSecrets(userId, String(args.walletId));
        if (!sec) {
          return { success: false, error: 'wallet not found' };
        }
        if (!sec.mnemonic) {
          return { success: false, error: 'No recovery phrase stored for this wallet. It may have been created before seed phrase backup was added.' };
        }
        console.log(`[toolExecutor] reveal_recovery_phrase for wallet=${sec.name} (${sec.address})`);
        return {
          success: true,
          data: {
            name: sec.name,
            address: sec.address,
            mnemonic: sec.mnemonic,
            securityWarning: 'Keep this recovery phrase secret and store it OFFLINE! Anyone with it can regenerate your wallet and access all funds. Never type it into any website.',
          },
        };
      }

      case 'delete_wallet': {
        if (!args.walletId) {
          return { success: false, error: 'walletId is required' };
        }
        const w = await getWallet(userId, String(args.walletId));
        if (!w) {
          return { success: false, error: 'wallet not found' };
        }
        const deleted = await deleteWallet(userId, String(args.walletId));
        if (!deleted) {
          return { success: false, error: 'could not delete wallet' };
        }
        console.log(`[toolExecutor] delete_wallet removed wallet=${w.name} (${w.address})`);
        return {
          success: true,
          data: {
            deleted: true,
            name: w.name,
            address: w.address,
            message: `Wallet "${w.name}" has been permanently deleted.`,
          },
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
