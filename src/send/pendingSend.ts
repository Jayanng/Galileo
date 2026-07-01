export interface PendingSend {
  walletId: string;
  walletName: string;
  toAddress: string;
  amountWei: string; // stringified bigint
  amountLabel: string; // e.g. "0.1 OG"
  summary: string; // markdown shown with the Confirm button
  recipientKind?: 'address' | 'username';
  resolvedUsername?: string;
}

const pending = new Map<string, PendingSend>();

export const pendingSends = {
  set(userId: string, s: PendingSend): void {
    pending.set(userId, s);
  },
  get(userId: string): PendingSend | undefined {
    return pending.get(userId);
  },
  clear(userId: string): void {
    pending.delete(userId);
  },
};
