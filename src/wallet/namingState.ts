// Tracks which wallet (per user) is awaiting a name. Set right after the user
// taps "I've saved my private key", and by Settings → Change name. In-memory and
// per-process: a restart mid-naming just leaves the wallet's current name.
const pending = new Map<string, string>();

export const naming = {
  set(userId: string, walletId: string): void {
    pending.set(userId, walletId);
  },
  get(userId: string): string | undefined {
    return pending.get(userId);
  },
  clear(userId: string): void {
    pending.delete(userId);
  },
};
