import { InputFile, type Context } from 'grammy';
import { createWallet, getWalletAddress, getBalanceFor } from '../wallet/walletService';
import { addressQr } from '../util/qr';
import { formatOG } from '../og/chain';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

const NO_WALLET = "You don't have a wallet yet. Send /wallet to create one.";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      '👋 *0G Memory Wallet*',
      '',
      'An AI-native wallet built on the 0G stack. Start by creating your on-chain wallet:',
      '',
      '• `/wallet` — create or show your wallet',
      '• `/address` — show your address + QR code',
      '• `/balance` — check your OG balance',
      '',
      'You can also just say things like _"create me a wallet"_.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    ['Commands:', '/wallet — create/show wallet', '/address — address + QR', '/balance — OG balance', '/help — this message'].join(
      '\n',
    ),
  );
}

export async function handleCreateWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  await ctx.replyWithChatAction('upload_photo');
  const { address, created } = await createWallet(userId);
  const png = await addressQr(address);
  const caption = created
    ? `✅ *Your 0G wallet is ready!*\n\n\`${address}\`\n\nSend OG to this address on 0G Galileo to fund it.`
    : `You already have a wallet:\n\n\`${address}\``;
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), { caption, parse_mode: 'Markdown' });
}

export async function handleShowAddress(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const address = await getWalletAddress(userId);
  if (!address) {
    await ctx.reply(NO_WALLET);
    return;
  }
  const png = await addressQr(address);
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), {
    caption: `Your wallet address:\n\n\`${address}\``,
    parse_mode: 'Markdown',
  });
}

export async function handleBalance(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const balance = await getBalanceFor(userId);
  if (balance === null) {
    await ctx.reply(NO_WALLET);
    return;
  }
  await ctx.reply(`💰 Balance: *${formatOG(balance)} OG*`, { parse_mode: 'Markdown' });
}
