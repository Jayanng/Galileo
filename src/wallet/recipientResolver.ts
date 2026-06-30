import * as usernameIndex from './usernameIndex';
import { walletStore } from './walletStore';
import { getActiveId } from './activeWallet';

export type ResolvedRecipient =
  | { kind: 'address'; address: string; isSelf: boolean }
  | { kind: 'username'; address: string; username: string; recipientUserId: string; isSelf: boolean }
  | { error: 'not_found' | 'no_wallets' };

export interface ResolverDeps {
  usernameLookup: (username: string) => string | null;
  listWallets: (userId: string) => Promise<Array<{ id: string; address: string }>>;
  getActiveId: (userId: string) => Promise<string | null>;
}

let _defaultDeps: ResolverDeps | null = null;
function defaultDeps(): ResolverDeps {
  if (_defaultDeps) return _defaultDeps;
  _defaultDeps = {
    usernameLookup: usernameIndex.lookup,
    listWallets: async (uid) => {
      const wallets = await walletStore.list(uid);
      return wallets.map((w) => ({ id: w.id, address: w.address }));
    },
    getActiveId,
  };
  return _defaultDeps;
}

/**
 * Resolve a Send recipient (either a raw 0x address or a Telegram @username)
 * to the address that should receive the funds.
 *
 * Behaviour:
 * - `0x` + 40 hex chars → returned as-is (lowercased). `isSelf` cannot be
 *   detected for raw addresses, so it is always false.
 * - `@handle` (or just `handle`, 5-32 chars of [A-Za-z0-9_]) → looked up via
 *   the in-memory username index. If the handle is unknown, returns
 *   `{ error: 'not_found' }`. If the user has no wallets, returns
 *   `{ error: 'no_wallets' }`. Otherwise picks the user's active wallet
 *   (per `getActiveId`) and falls back to `wallets[0]` when none is active.
 *   `isSelf` is true when the resolved userId equals `senderUserId`.
 * - Anything else → `{ error: 'not_found' }`.
 */
export async function resolveRecipientToAddress(
  input: string,
  senderUserId: string,
  deps?: ResolverDeps
): Promise<ResolvedRecipient> {
  const trimmed = input.trim();
  const d = deps ?? defaultDeps();

  // Raw 0x address.
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { kind: 'address', address: trimmed.toLowerCase(), isSelf: false };
  }

  // Telegram username: strip leading @, lowercase, validate.
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) {
    return { error: 'not_found' };
  }

  const userId = d.usernameLookup(handle);
  if (!userId) return { error: 'not_found' };

  const wallets = await d.listWallets(userId);
  if (wallets.length === 0) return { error: 'no_wallets' };

  const activeId = await d.getActiveId(userId);
  const active = activeId ? wallets.find((w) => w.id === activeId) : undefined;
  const chosen = active ?? wallets[0];

  return {
    kind: 'username',
    address: chosen.address,
    username: handle,
    recipientUserId: userId,
    isSelf: userId === senderUserId,
  };
}
