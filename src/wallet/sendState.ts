export interface SendDraft {
  stage: 'address' | 'amount';
  to?: string;
  recipientKind?: 'address' | 'username';
  resolvedUsername?: string;
}

const pending = new Map<string, SendDraft>();

export const sendState = {
  set(userId: string, draft: SendDraft): void {
    pending.set(userId, draft);
  },
  get(userId: string): SendDraft | undefined {
    return pending.get(userId);
  },
  clear(userId: string): void {
    pending.delete(userId);
  },
};
