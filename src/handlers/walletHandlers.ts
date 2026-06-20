import { InlineKeyboard, InputFile, type Context } from 'grammy';
import {
  createWallet,
  listWallets,
  getWallet,
  getWalletBalance,
  getAllBalances,
  getWalletSecrets,
  type WalletSecrets,
} from '../wallet/walletService';
import { addressQr } from '../util/qr';
import { formatOG } from '../og/chain';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

const NO_WALLETS = "You don't have any wallets yet. Send /wallet to create one.";

export async function handleStart(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      '👋 *0G Memory Wallet*',
      '',
      'An AI-native wallet on the 0G stack. Hold multiple wallets and just talk to me in plain language.',
      '',
      '• `/wallet` — create a new wallet (shows your key + seed once)',
      '• `/address` — pick a wallet to view its address + QR',
      '• `/balance` — balances across all your wallets',
      '• `/privatekey` — reveal a wallet’s private key & seed phrase',
      '',
      'Or just say _"create me a wallet"_, _"what’s my balance?"_, _"rename Wallet 1 to Savings"_.',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Commands:',
      '/wallet — create a new wallet (reveals key + seed once)',
      '/address — choose a wallet to view (address + QR)',
      '/balance — balances of all your wallets',
      '/privatekey — reveal a wallet’s private key & seed phrase',
      '/help — this message',
      '',
      'You can also just chat: "create a wallet called savings", "rename Wallet 1 to main", "what’s my balance?"',
    ].join('\n'),
  );
}

// ── Secret-reveal helpers ───────────────────────────────────────────────────

function savedKeyboard(walletId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ I've saved my private key", `saved:${walletId}`);
}

function secretCaption(s: WalletSecrets): string {
  return [
    `🔐 *${s.name}*`,
    '',
    '📬 *Address*',
    `\`${s.address}\``,
    '',
    '🔑 *Private key*',
    `\`${s.privateKey}\``,
    '',
    ...(s.mnemonic
      ? ['📝 *Seed phrase*', `\`${s.mnemonic}\``]
      : ['📝 *Seed phrase:* _not available for this wallet_']),
    '',
    '⚠️ Anyone with your private key or seed phrase controls this wallet. Save them somewhere safe and never share them.',
    'Tap the button below once you have saved them.',
  ].join('\n');
}

async function sendReveal(ctx: Context, secrets: WalletSecrets): Promise<void> {
  const png = await addressQr(secrets.address);
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), {
    caption: secretCaption(secrets),
    parse_mode: 'Markdown',
    reply_markup: savedKeyboard(secrets.id),
  });
}

async function sendCleanAddress(
  ctx: Context,
  wallet: { name: string; address: string },
): Promise<void> {
  const png = await addressQr(wallet.address);
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), {
    caption: [`*${wallet.name}*`, '', `\`${wallet.address}\``, '', 'Scan to receive OG on 0G Galileo.'].join('\n'),
    parse_mode: 'Markdown',
  });
}

// ── Commands ────────────────────────────────────────────────────────────────

export async function handleCreateWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  await ctx.replyWithChatAction('upload_photo');
  const wallet = await createWallet(userId);
  const secrets = await getWalletSecrets(userId, wallet.id);
  if (!secrets) {
    await ctx.reply('Wallet created, but I could not read it back. Try /privatekey.');
    return;
  }
  await sendReveal(ctx, secrets);
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

// ── Private key / seed reveal (explicit, command + button only) ──────────────

export async function handlePrivateKeyCommand(ctx: Context): Promise<void> {
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
  for (const w of wallets) kb.text(w.name, `pk:${w.id}`).row();
  await ctx.reply('⚠️ Reveal a wallet’s *private key & seed phrase*. Tap the wallet:', {
    reply_markup: kb,
    parse_mode: 'Markdown',
  });
}

export async function handleRevealPrivateKey(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = ctx.callbackQuery?.data?.match(/^pk:(.+)$/)?.[1];
  await ctx.answerCallbackQuery();
  if (!userId || !walletId) return;

  const secrets = await getWalletSecrets(userId, walletId);
  if (!secrets) {
    await ctx.reply('That wallet no longer exists.');
    return;
  }
  await sendReveal(ctx, secrets);
}

export async function handleSavedKey(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = ctx.callbackQuery?.data?.match(/^saved:(.+)$/)?.[1];
  await ctx.answerCallbackQuery({ text: 'Hidden. Keep it somewhere safe!' });
  if (!userId || !walletId) return;

  // Remove the sensitive message from the chat.
  try {
    await ctx.deleteMessage();
  } catch {
    // Message older than 48h or already deleted — ignore.
  }
  const wallet = await getWallet(userId, walletId);
  if (wallet) await sendCleanAddress(ctx, wallet);
}
