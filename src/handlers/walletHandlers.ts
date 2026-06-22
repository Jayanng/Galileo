import { InlineKeyboard, InputFile, type Context } from 'grammy';
import {
  createWallet,
  listWallets,
  getWallet,
  renameWallet,
  getWalletBalance,
  getWalletAssets,
  getAllBalances,
  getWalletSecrets,
  type WalletInfo,
  type WalletSecrets,
} from '../wallet/walletService';
import { getActiveId, setActiveId } from '../wallet/activeWallet';
import { naming } from '../wallet/namingState';
import { addressQr } from '../util/qr';
import { formatOG } from '../og/chain';
import { FAQ_TEXT } from '../faq';

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

const NO_WALLETS = "You don't have any wallets yet. Send /wallet to create one.";

// ── Active wallet ────────────────────────────────────────────────────────────

/** The user's selected wallet, defaulting to the first one if none is set. */
async function resolveActive(userId: string, wallets: WalletInfo[]): Promise<WalletInfo | null> {
  if (wallets.length === 0) return null;
  const activeId = await getActiveId(userId);
  return wallets.find((w) => w.id === activeId) ?? wallets[0]!;
}

// ── Home dashboard ───────────────────────────────────────────────────────────

// Default wallet names ("Wallet 3") render as a compact "W3"; custom names show as-is.
function walletLabel(w: WalletInfo, index: number, active: boolean): string {
  const base = /^Wallet \d+$/.test(w.name) ? `W${index + 1}` : w.name;
  return active ? `✅ ${base}` : base;
}

async function renderHome(userId: string): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const wallets = await listWallets(userId);
  const kb = new InlineKeyboard();
  const intro = [
    '👋 *Welcome to Galileo*',
    'Create addresses, manage portfolios, and get AI-driven replies.',
  ];

  if (wallets.length === 0) {
    kb.text('➕ Create wallet', 'home:new');
    return {
      text: [...intro, '', 'You don’t have a wallet yet — create one to get started.'].join('\n'),
      keyboard: kb,
    };
  }

  const active = (await resolveActive(userId, wallets))!;
  const assets = await getWalletAssets(active.address);
  const assetLines = assets.map((a) => `• *${formatOG(a.balance)} ${a.symbol}*`);

  const text = [
    ...intro,
    '',
    `💰 *Assets in ${active.name}*`,
    ...assetLines,
    '',
    '🔐 Export your wallet via *Settings → Export private key*.',
  ].join('\n');

  // Wallet selector, two per row, ✅ on the active one.
  for (let i = 0; i < wallets.length; i += 2) {
    const a = wallets[i]!;
    kb.text(walletLabel(a, i, a.id === active.id), `sel:${a.id}`);
    const b = wallets[i + 1];
    if (b) kb.text(walletLabel(b, i + 1, b.id === active.id), `sel:${b.id}`);
    kb.row();
  }
  kb.text('📥 Deposit', 'home:deposit').text('📤 Send', 'home:send').row();
  kb.text('🔄 Swap', 'home:swap').text('⚙️ Settings', 'home:settings').row();
  kb.text('➕ New wallet', 'home:new').text('❓ Help', 'home:help');

  return { text, keyboard: kb };
}

async function refreshHome(ctx: Context, userId: string): Promise<void> {
  const { text, keyboard } = await renderHome(userId);
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch {
    // "message is not modified" or uneditable — ignore.
  }
}

export async function handleStart(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  const { text, keyboard } = await renderHome(userId);
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Commands:',
      '/start — open your wallet dashboard',
      '/wallet — create a new wallet (reveals key + seed once)',
      '/address — choose a wallet to view (address + QR)',
      '/balance — balances of all your wallets',
      '/privatekey — reveal a wallet’s private key',
      '/wrap — wrap OG → WOG (e.g. /wrap 0.1)',
      '/unwrap — unwrap WOG → OG (e.g. /unwrap 0.1)',
      '/swap — swap tokens (e.g. /swap 0.1 OG USDC), or open the Swap menu',
      '/send — send OG to an address (e.g. /send 0x... 0.1)',
      '/help — this message',
      '',
      'You can also just chat: "create a wallet called savings", "wrap 0.1 OG", "what’s my balance?"',
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
    '⚠️ Anyone with your private key controls this wallet. Save it somewhere safe and never share it.',
    'Tap the button below once you have saved it.',
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

/** Create a wallet, make it active, and reveal its key + seed. */
async function createAndReveal(ctx: Context, userId: string): Promise<void> {
  await ctx.replyWithChatAction('upload_photo');
  const wallet = await createWallet(userId);
  await setActiveId(userId, wallet.id);
  const secrets = await getWalletSecrets(userId, wallet.id);
  if (!secrets) {
    await ctx.reply('Wallet created, but I could not read it back. Try /privatekey.');
    return;
  }
  await sendReveal(ctx, secrets);
}

// ── Commands ────────────────────────────────────────────────────────────────

export async function handleCreateWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  if (!userId) {
    await ctx.reply('Sorry, I could not identify your account.');
    return;
  }
  await createAndReveal(ctx, userId);
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

// ── Home dashboard callbacks ─────────────────────────────────────────────────

export async function handleSelectWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = ctx.callbackQuery?.data?.match(/^sel:(.+)$/)?.[1];
  if (!userId || !walletId) {
    await ctx.answerCallbackQuery();
    return;
  }
  await setActiveId(userId, walletId);
  const wallet = await getWallet(userId, walletId);
  await ctx.answerCallbackQuery({ text: wallet ? `Active: ${wallet.name}` : 'Selected' });
  await refreshHome(ctx, userId);
}

export async function handleDeposit(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  const active = await resolveActive(userId, await listWallets(userId));
  if (!active) {
    await ctx.reply('Create a wallet first (tap “New wallet”).');
    return;
  }
  await sendCleanAddress(ctx, active);
}

export async function handleSettings(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  const active = await resolveActive(userId, await listWallets(userId));
  const text = active ? `⚙️ *Settings* — active wallet: *${active.name}*` : '⚙️ *Settings*';
  const kb = new InlineKeyboard()
    .text('🔑 Export private key', 'home:export')
    .row()
    .text('✏️ Change name', 'home:rename')
    .row()
    .text('⬅️ Back', 'home:back');
  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: kb });
  } catch {
    // ignore
  }
}

export async function handleExport(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  const active = await resolveActive(userId, await listWallets(userId));
  if (!active) {
    await ctx.reply('Create a wallet first.');
    return;
  }
  const secrets = await getWalletSecrets(userId, active.id);
  if (!secrets) {
    await ctx.reply('Could not read that wallet.');
    return;
  }
  await sendReveal(ctx, secrets);
}

export async function handleHomeBack(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  await refreshHome(ctx, userId);
}

export async function handleFaq(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  const kb = new InlineKeyboard().text('⬅️ Back', 'home:back');
  try {
    await ctx.editMessageText(FAQ_TEXT, { parse_mode: 'Markdown', reply_markup: kb });
  } catch {
    await ctx.reply(FAQ_TEXT, { parse_mode: 'Markdown' });
  }
}

export async function handleNewWallet(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  await createAndReveal(ctx, userId);
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
  await ctx.reply('⚠️ Reveal a wallet’s *private key*. Tap the wallet:', {
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
  if (!wallet) return;

  // Prompt the user to name the wallet — their next message is captured as the name.
  naming.set(userId, walletId);
  const png = await addressQr(wallet.address);
  await ctx.replyWithPhoto(new InputFile(png, 'wallet.png'), {
    caption: [
      `*${wallet.name}*`,
      '',
      `\`${wallet.address}\``,
      '',
      'What would you like to name this wallet? Send a name, or /skip to keep it.',
    ].join('\n'),
    parse_mode: 'Markdown',
  });
}

// ── Wallet naming (after key-save, or Settings → Change name) ────────────────

export async function handleNameReply(ctx: Context, text: string): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = userId ? naming.get(userId) : undefined;
  if (!userId || !walletId) return;
  const name = text.trim().slice(0, 32);
  if (!name) {
    await ctx.reply('That name is empty — send a short name, or /skip.');
    return;
  }
  await renameWallet(userId, walletId, name);
  naming.clear(userId);
  const wallet = await getWallet(userId, walletId);
  await ctx.reply(`✅ Saved as *${wallet?.name ?? name}*.`, { parse_mode: 'Markdown' });
}

export async function handleSkip(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  const walletId = userId ? naming.get(userId) : undefined;
  if (!userId || !walletId) {
    await ctx.reply('Nothing to name right now.');
    return;
  }
  naming.clear(userId);
  const wallet = await getWallet(userId, walletId);
  await ctx.reply(`Kept the name${wallet ? ` *${wallet.name}*` : ''}.`, { parse_mode: 'Markdown' });
}

export async function handleChangeName(ctx: Context): Promise<void> {
  const userId = userIdOf(ctx);
  await ctx.answerCallbackQuery();
  if (!userId) return;
  const active = await resolveActive(userId, await listWallets(userId));
  if (!active) {
    await ctx.reply('Create a wallet first.');
    return;
  }
  naming.set(userId, active.id);
  await ctx.reply(`✏️ Send a new name for *${active.name}* (or /skip to keep it).`, {
    parse_mode: 'Markdown',
  });
}
