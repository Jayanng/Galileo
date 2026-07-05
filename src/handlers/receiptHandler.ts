import type { Context } from 'grammy';
import { config } from '../config';
import { receiptStore } from '../receipts';

/**
 * /receipt command: list the user's most recent Verified Intent Receipts.
 *
 * Each row shows timestamp + action type + status + a shortened receipt id.
 * The full receipt is recoverable from 0G Storage via the root hash shown in
 * the Proof Center at /verify/:rootHash.
 */
export async function handleReceipt(ctx: Context): Promise<void> {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  const receipts = await receiptStore.listForUser(userId, 10);

  if (receipts.length === 0) {
    await ctx.reply(
      '🧾 No receipts yet. Send OG (/send), swap (/swap), schedule a DCA, arm an alert, or reveal a key — a Verified Intent Receipt is created automatically for each action.',
    );
    return;
  }

  const lines = receipts.map((r) => {
    const ts = new Date(r.createdAt).toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'short',
      timeStyle: 'short',
    }) + ' UTC';
    const icon =
      r.actionType === 'send' ? '📤' :
      r.actionType === 'swap' ? '🔄' :
      r.actionType === 'dca' ? '📊' :
      r.actionType === 'alert' ? '🔔' :
      r.actionType === 'key_reveal' ? '🔐' : '🧾';
    const status = r.status;
    const short = `${r.receiptId.slice(0, 8)}…`;
    const root =
      r.actionType === 'key_reveal' ? '(local-only)' :
      r.rootHash ? `root 0x${r.rootHash.slice(2, 10)}…` : '(pending upload)';
    return `${icon} ${status.padEnd(8)} \`${ts}\`  ${short}  ${root}`;
  });

  const proofUrl = config.OG_STORAGE_ENABLED ? 'https://galileo-test.fly.dev/verify/' : null;

  await ctx.reply(
    [
      `🧾 *Recent receipts* (${receipts.length})`,
      '',
      ...lines,
      '',
      proofUrl
        ? `Verify any receipt by its root hash at ${proofUrl}`
        : '_0G Storage is disabled — receipts are kept locally only._',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}
