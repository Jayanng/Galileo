// Tracks which freshly created wallet (per user) is awaiting a name.
// In-memory and per-process: a restart mid-naming simply leaves the default name,
// which the user can change later.
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
