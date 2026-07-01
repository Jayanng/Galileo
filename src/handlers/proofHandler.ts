import type { Context } from 'grammy';
import { getRecentProofs } from '../ai/memory';
import { config } from '../config';

/**
 * /proof command: list the user's last 10 TEE-verified chats.
 *
 * Each row shows timestamp + verification symbol + a shortened chatID.
 * The full chatID is in the user's 0G Storage snapshot and can be inspected
 * with the standard 0G Storage CLI / explorer.
 *
 * Empty state: "🔐 No verified chats yet." (when memory is enabled but the
 * user has not had any verified AI replies yet) OR a fallback-mode message
 * (when OG_COMPUTE_FALLBACK=true — no proofs are recorded in that mode).
 *
 * See also the full integration reference: 0G-INTEGRATION.md at repo root,
 * and the public proof index at GET /proofs (health endpoint).
 */
export async function handleProof(ctx: Context): Promise<void> {
  const userId = ctx.from?.id ? String(ctx.from.id) : null;
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }

  if (config.OG_COMPUTE_FALLBACK) {
    await ctx.reply(
      [
        '🔐 *TEE proofs unavailable*',
        '',
        'The bot is running in `OG_COMPUTE_FALLBACK=true` mode — every reply is sent through the legacy router URL with no TEE verification.',
        '',
        'Set `OG_COMPUTE_FALLBACK=false` in `.env` and restart the bot to enable verifiable inference.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const proofs = await getRecentProofs(userId, 10);

  if (proofs.length === 0) {
    await ctx.reply([
        '🔐 No verified chats yet. Send me a message first and try again.',
        '',
        'See the [0G Integration Reference](https://github.com/Jayanng/Galileo/blob/Master/0G-INTEGRATION.md) for the full audit trail.',
      ].join('\n'),
      {
        parse_mode: 'Markdown',
      },
    );
    return;
  }

  const lines = proofs.map((p) => {
    const ts =
      new Date(p.ts).toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'short',
        timeStyle: 'short',
      }) + ' UTC';
    const symbol =
      p.verified === true ? '✓ verified' : p.verified === false ? '✗ invalid' : '⏳ pending';
    const short = p.chatID ? `0x${p.chatID.slice(2, 12)}…${p.chatID.slice(-6)}` : '(no chatID)';
    const providerShort = p.providerAddress
      ? `0x${p.providerAddress.slice(2, 8)}…${p.providerAddress.slice(-4)}`
      : 'unknown';
    return `${symbol}  \`${ts}\`  ${short}  (provider ${providerShort})`;
  });

  await ctx.reply(
    [
      `🔐 *Recent verified chats* (${proofs.length})`,
      '',
      ...lines,
      '',
      '_TEE signature is checked against the provider\'s attested signer address. ✓ = valid, ✗ = failed, ⏳ = verification not completed._',
      '',
      '📖 [0G Integration Reference](https://github.com/Jayanng/Galileo/blob/Master/0G-INTEGRATION.md) — full audit trail for all 0G touchpoints.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}
