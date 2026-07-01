// Tracks a per-user swap awaiting an amount (guided dashboard flow or a bare
// /wrap //unwrap //swap command). In-memory and per-process — mirrors
// namingState.ts; a restart mid-entry just drops the half-finished swap.

export interface SwapDraft {
  from: string; // 'OG' | 'WOG' | 'USDC' | 'USDT' | 0x address
  to: string;
  fromLabel: string;
  toLabel: string;
}

const pending = new Map<string, SwapDraft>();

export const swapState = {
  set(userId: string, draft: SwapDraft): void {
    pending.set(userId, draft);
  },
  get(userId: string): SwapDraft | undefined {
    return pending.get(userId);
  },
  clear(userId: string): void {
    pending.delete(userId);
  },
};
