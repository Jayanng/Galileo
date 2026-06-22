// A swap prepared by the AI tool, awaiting the user's Confirm tap. In-memory and
// per-process (mirrors namingState.ts) — a restart just drops un-confirmed swaps.

export interface PendingSwap {
  kind: 'wrap' | 'unwrap' | 'dex';
  walletId: string;
  walletName: string;
  fromSymbol: string;
  toSymbol: string;
  amountWei: string; // input amount, stringified bigint
  amountInLabel: string; // e.g. "5 OG"
  estOutLabel: string; // e.g. "5 WOG" or "~12.3 USDC"
  summary: string; // human summary shown with the Confirm button
  // dex only:
  minOutWei?: string;
  path?: string[];
  routeKind?: 'native-to-token' | 'token-to-native' | 'token-to-token';
}

const pending = new Map<string, PendingSwap>();

export const pendingSwaps = {
  set(userId: string, s: PendingSwap): void {
    pending.set(userId, s);
  },
  get(userId: string): PendingSwap | undefined {
    return pending.get(userId);
  },
  clear(userId: string): void {
    pending.delete(userId);
  },
};
