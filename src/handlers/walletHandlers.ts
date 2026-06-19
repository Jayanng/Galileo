import { InlineKeyboard, InputFile, type Context } from 'grammy';
import {
  createWallet,
  listWallets,
  getWallet,
  renameWallet,
  getWalletBalance,
  getAllBalances,
} from '../wallet/walletService';
import { naming } from '../wallet/namingState';
import { addressQr } from '../util/qr';
import { formatOG } from '../og/chain';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

const NAME_MAX = 32;
const NO_WALLETS = "You don't have any wallets yet. Send /wallet to create one.";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      '👋 *0G Memory Wallet*',
      '',
      'An AI-native wallet on the 0G stack. You can hold multiple named wallets:',
      '',
      '• `/wallet` — create a new wallet (then name it)',
      '• `/address` — pick one of your wallets to view',
      '• `/balance` — balances across all your wallets',
      '',
      'You can also just say _"create me a wallet"_.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Commands:',
      '/wallet — create a new wallet, then name it',
      '/address — choose a wallet to view (address + QR)',
      '/balance — balances of all your wallets',
      '/skip — keep the default name for a just-created wallet',
      '/help — this message',
    ].join('\n'),
  );
}

export async function handleCreateWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  await ctx.replyWithChatAction('upload_photo');
  const wallet = await createWallet(userId);
  naming.set(userId, wallet.id);
  const png = await addressQr(wallet.address);
  const caption = [
    `✅ *New wallet created* (default name: _${wallet.name}_)`,
    '',
    `\`${wallet.address}\``,
    '',
    'What would you like to name it? Send a name, or /skip to keep the default.',
  ].join('\n');
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), { caption, parse_mode: 'Markdown' });
}

// Captures the next plain message as the name for a just-created wallet.
export async function handleNameReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = userId ? naming.get(userId) : undefined;
  if (!userId || !walletId) return;

  const name = text.trim().slice(0, NAME_MAX);
  if (!name) {
    await ctx.reply('That name is empty — send a short name, or /skip.');
    return;
  }
  await renameWallet(userId, walletId, name);
  naming.clear(userId);
  const wallet = await getWallet(userId, walletId);
  if (!wallet) {
    await ctx.reply(`Saved as *${name}* ✅`, { parse_mode: 'Markdown' });
    return;
  }
  const png = await addressQr(wallet.address);
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), {
    caption: `Saved as *${wallet.name}* ✅\n\n\`${wallet.address}\``,
    parse_mode: 'Markdown',
  });
}

export async function handleSkip(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = userId ? naming.get(userId) : undefined;
  if (!userId || !walletId) {
    await ctx.reply('Nothing to skip.');
    return;
  }
  naming.clear(userId);
  const wallet = await getWallet(userId, walletId);
  await ctx.reply(`Kept the default name${wallet ? ` *${wallet.name}*` : ''}. ✅`, {
    parse_mode: 'Markdown',
  });
}

export async function handleListAddresses(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const wallets = await listWallets(userId);
  if (wallets.length === 0) {
    await ctx.reply(NO_WALLETS);
    return;
  }
  const kb = new InlineKeyboard();
  for (const w of wallets) kb.text(w.name, `wallet:${w.id}`).row();
  await ctx.reply('Your wallets — tap one to view it:', { reply_markup: kb });
}

export async function handleWalletCallback(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = ctx.callbackQuery?.data?.match(/^wallet:(.+)$/)?.[1];
  await ctx.answerCallbackQuery();
  if (!userId || !walletId) return;

  const wallet = await getWallet(userId, walletId);
  if (!wallet) {
    await ctx.reply('That wallet no longer exists.');
    return;
  }
  const balance = await getWalletBalance(userId, walletId);
  const png = await addressQr(wallet.address);
  const caption = [
    `*${wallet.name}*`,
    '',
    `\`${wallet.address}\``,
    '',
    `Balance: *${balance === null ? '—' : formatOG(balance)} OG*`,
  ].join('\n');
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), { caption, parse_mode: 'Markdown' });
}

export async function handleBalance(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const balances = await getAllBalances(userId);
  if (balances.length === 0) {
    await ctx.reply(NO_WALLETS);
    return;
  }
  const lines = balances.map((b) => `• *${b.name}* — ${formatOG(b.balance)} OG`);
  await ctx.reply(['💰 *Your balances:*', ...lines].join('\n'), { parse_mode: 'Markdown' });
}
