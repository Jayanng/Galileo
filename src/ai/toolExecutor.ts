import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  getAllBalances,
  renameWallet,
  getWalletSecrets,
  deleteWallet,
  getOnChainTxCount,
} from '../wallet/walletService';
import { formatOG } from '../og/chain';
import { search, getRecentProofs, transactionStats } from './memory';
import { buildPortfolio } from '../og/portfolio';
import { getPriceUSD, getPriceByCoinGeckoId, KNOWN_SYMBOLS, SYMBOL_TO_COINGECKO_ID } from '../og/prices';
import { prepareSwap } from '../swap/swapService';
import {
  intentStore,
  newIntentId,
  parseSchedule,
  computeNextRun,
  summarize,
  isSupportedDcaPath,
  type DcaIntent,
  type AlertIntent,
} from '../intents';
import { getActiveId } from '../wallet/activeWallet';

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

      case 'transaction_stats': {
        const timeRange = typeof args.timeRange === 'string' ? args.timeRange : undefined;
        let fromTs: number | undefined;
        let toTs: number | undefined;
        if (timeRange && timeRange !== 'all') {
          const now = Date.now();
          toTs = now;
          switch (timeRange) {
            case 'today': {
              const d = new Date();
              fromTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
              break;
            }
            case 'yesterday':
              fromTs = now - 86400000;
              break;
            case 'last7days':
              fromTs = now - 7 * 86400000;
              break;
            case 'last30days':
              fromTs = now - 30 * 86400000;
              break;
            default:
              toTs = undefined;
              break;
          }
        }
        const [stats, onChainTxCount] = await Promise.all([
          transactionStats(userId, fromTs, toTs),
          getOnChainTxCount(userId),
        ]);
        return {
          success: true,
          data: {
            onChainTxCount,
            recordedCount: stats.count,
            byType: stats.byType,
            volumeByUnit: stats.volumeByUnit,
            note:
              'onChainTxCount is the true number of on-chain transactions sent from the user\'s wallets. volumeByUnit covers only bot-recorded sends/swaps.',
          },
        };
      }

      case 'dca_create': {
        const fromToken = String(args.fromToken ?? '').toUpperCase().trim();
        const toToken = String(args.toToken ?? '').toUpperCase().trim();
        const amount = String(args.amount ?? '').trim();
        const scheduleStr = String(args.schedule ?? '').trim();
        const walletId = args.walletId ? String(args.walletId) : undefined;
        if (!fromToken || !toToken || !amount || !scheduleStr) {
          const missing = [
            !fromToken && 'fromToken',
            !toToken && 'toToken',
            !amount && 'amount',
            !scheduleStr && 'schedule',
          ].filter(Boolean);
          return {
            success: false,
            error: `Missing required field(s): ${missing.join(', ')}. Example call: { fromToken: 'OG', toToken: 'USDC', amount: '1', schedule: 'weekly' }.`,
          };
        }
        const allowedTokens = new Set(['OG', 'WOG', 'USDC', 'USDT']);
        if (!allowedTokens.has(fromToken) || !allowedTokens.has(toToken)) {
          return {
            success: false,
            error: `Invalid token in DCA path ${fromToken}\u2192${toToken}. fromToken and toToken must each be one of: OG, WOG, USDC, USDT.`,
          };
        }
        if (fromToken === toToken) {
          return { success: false, error: 'fromToken and toToken must differ.' };
        }
        if (!isSupportedDcaPath(fromToken, toToken)) {
          return {
            success: false,
            error: `DCA path ${fromToken}\u2192${toToken} is not supported yet. Supported paths: OG\u2192USDC, OG\u2192USDT, OG\u2192WOG (wrap), WOG\u2192OG (unwrap).`,
          };
        }
        let schedule;
        try {
          schedule = parseSchedule(scheduleStr);
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
        const wallets = await listWallets(userId);
        if (wallets.length === 0) {
          return { success: false, error: 'You have no wallets yet — send /wallet to create one first.' };
        }
        let resolvedWalletId = walletId;
        if (resolvedWalletId && !wallets.find((w) => w.id === resolvedWalletId)) {
          return { success: false, error: 'walletId does not match any of your wallets.' };
        }
        if (!resolvedWalletId) {
          const active = await getActiveId(userId);
          resolvedWalletId = active ?? wallets[0]!.id;
        }
        const now = Date.now();
        const intent: DcaIntent = {
          id: newIntentId(),
          userId,
          type: 'dca',
          status: 'active',
          fromToken,
          toToken,
          amount,
          schedule,
          walletId: resolvedWalletId!,
          nextRunAt: computeNextRun(schedule, now),
          lastExecutedAt: null,
          createdAt: now,
        };
        await intentStore.add(intent);
        console.log(`[toolExecutor] dca_create id=${intent.id} ${amount} ${fromToken}\u2192${toToken} ${schedule.raw}`);
        return {
          success: true,
          data: {
            id: intent.id,
            type: 'dca',
            summary: summarize(intent),
            status: intent.status,
            schedule: intent.schedule.raw,
            nextRunAt: new Date(intent.nextRunAt).toISOString(),
            note: 'No funds have moved yet \u2014 the worker will execute on the next scheduled tick. Use /intents to manage it.',
          },
        };
      }

      case 'alert_create': {
        const symbolRaw = String(args.symbol ?? '').trim();
        const operator = String(args.operator ?? '').trim() as '<' | '>' | '<=' | '>=';
        const threshold = Number(args.threshold);
        if (!symbolRaw) {
          return {
            success: false,
            error: `Missing required field: symbol. Example call: { symbol: 'OG', operator: '<', threshold: 1 }.`,
          };
        }
        if (!['<', '>', '<=', '>='].includes(operator)) {
          return {
            success: false,
            error: `Invalid operator '${operator}'. Must be one of: '<', '>', '<=', '>='. Example: alert if OG drops below $1 \u2192 { symbol: 'OG', operator: '<', threshold: 1 }.`,
          };
        }
        if (!Number.isFinite(threshold) || threshold <= 0) {
          return {
            success: false,
            error: `Invalid threshold '${args.threshold}'. Must be a positive number (USD). Example: { symbol: 'OG', operator: '<', threshold: 1 }.`,
          };
        }
        const upper = symbolRaw.toUpperCase();
        const lower = symbolRaw.toLowerCase();
        const knownId = SYMBOL_TO_COINGECKO_ID[upper];
        let coingeckoId: string | null = knownId ?? null;
        if (!coingeckoId && !['USDC', 'USDT'].includes(upper)) {
          const probe = await getPriceUSD(upper);
          if (probe !== null) coingeckoId = SYMBOL_TO_COINGECKO_ID[upper] ?? lower;
          else {
            const cg = await getPriceByCoinGeckoId(lower);
            if (cg !== null) coingeckoId = lower;
          }
        }
        if (!coingeckoId) {
          return {
            success: false,
            error: `Could not resolve symbol "${symbolRaw}" to a known token. Use one of: ${KNOWN_SYMBOLS.join(', ')} \u2014 or pass a CoinGecko ID like 'bitcoin', 'ethereum', 'solana'.`,
          };
        }
        const intent: AlertIntent = {
          id: newIntentId(),
          userId,
          type: 'alert',
          status: 'active',
          symbol: upper,
          coingeckoId,
          operator,
          threshold,
          lastCheckedAt: null,
          firedAt: null,
          createdAt: Date.now(),
        };
        await intentStore.add(intent);
        console.log(`[toolExecutor] alert_create id=${intent.id} ${upper} ${operator} $${threshold}`);
        return {
          success: true,
          data: {
            id: intent.id,
            type: 'alert',
            summary: summarize(intent),
            status: intent.status,
            symbol: intent.symbol,
            operator: intent.operator,
            threshold: intent.threshold,
            note: 'The worker checks the price on every tick (~30s). Use /intents to manage it.',
          },
        };
      }

      case 'list_intents': {
        const intents = await intentStore.listForUser(userId);
        return {
          success: true,
          data: {
            count: intents.length,
            intents: intents.map((i) => ({
              id: i.id,
              type: i.type,
              summary: summarize(i),
              status: i.status,
              ...(i.type === 'dca'
                ? { schedule: i.schedule.raw, nextRunAt: new Date(i.nextRunAt).toISOString(), lastExecutedAt: i.lastExecutedAt ? new Date(i.lastExecutedAt).toISOString() : null }
                : { symbol: i.symbol, operator: i.operator, threshold: i.threshold, firedAt: i.firedAt ? new Date(i.firedAt).toISOString() : null }),
            })),
          },
        };
      }

      case 'cancel_intent': {
        const id = String(args.id ?? '').trim();
        if (!id) return { success: false, error: 'id is required.' };
        const existing = await intentStore.get(id);
        if (!existing || existing.userId !== userId) return { success: false, error: 'intent not found.' };
        const ok = await intentStore.remove(id);
        if (!ok) return { success: false, error: 'could not remove intent.' };
        console.log(`[toolExecutor] cancel_intent id=${id} type=${existing.type}`);
        return { success: true, data: { cancelled: true, id, type: existing.type, summary: summarize(existing) } };
      }

      case 'pause_intent': {
        const id = String(args.id ?? '').trim();
        if (!id) return { success: false, error: 'id is required.' };
        const existing = await intentStore.get(id);
        if (!existing || existing.userId !== userId) return { success: false, error: 'intent not found.' };
        if (existing.status === 'paused') {
          return { success: true, data: { id, status: 'paused', note: 'already paused' } };
        }
        const updated = await intentStore.update(id, { status: 'paused' });
        if (!updated) return { success: false, error: 'could not pause intent.' };
        console.log(`[toolExecutor] pause_intent id=${id} type=${existing.type}`);
        return { success: true, data: { id, status: 'paused', summary: summarize(updated) } };
      }

      case 'resume_intent': {
        const id = String(args.id ?? '').trim();
        if (!id) return { success: false, error: 'id is required.' };
        const existing = await intentStore.get(id);
        if (!existing || existing.userId !== userId) return { success: false, error: 'intent not found.' };
        if (existing.status === 'active') {
          return { success: true, data: { id, status: 'active', note: 'already active' } };
        }
        const updated = await intentStore.update(id, { status: 'active' });
        if (!updated) return { success: false, error: 'could not resume intent.' };
        console.log(`[toolExecutor] resume_intent id=${id} type=${existing.type}`);
        return { success: true, data: { id, status: 'active', summary: summarize(updated) } };
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
