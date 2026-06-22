import { Bot } from 'grammy';
import { config } from './config';
import {
  handleStart,
  handleHelp,
  handleCreateWallet,
  handleListAddresses,
  handleWalletCallback,
  handleBalance,
  handlePrivateKeyCommand,
  handleRevealPrivateKey,
  handleSavedKey,
  handleSelectWallet,
  handleDeposit,
  handleSettings,
  handleExport,
  handleHomeBack,
  handleNewWallet,
  handleChangeName,
  handleFaq,
  handleNameReply,
  handleSkip,
} from './handlers/walletHandlers';
import { naming } from './wallet/namingState';
import { swapState } from './wallet/swapState';
import { handleAiMessage } from './handlers/aiHandler';
import { handleSwapConfirm, handleSwapCancel } from './handlers/swapHandlers';
import {
  handleSwapMenu,
  handleSwapNew,
  handleSwapAmountReply,
  handleWrapCommand,
  handleUnwrapCommand,
  handleSwapCommand,
  stageSwap,
  parseSwapText,
} from './handlers/swapUiHandlers';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // 1) Naming interceptor: when a wallet is awaiting a name (after the user saved
  //    their key, or via Settings → Change name), capture their next plain message
  //    as the name. Commands fall through.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId || !naming.get(userId)) return next();
    if (ctx.message.text.startsWith('/')) {
      naming.clear(userId);
      return next();
    }
    await handleNameReply(ctx, ctx.message.text);
  });

  // 1b) Swap-amount interceptor: when a swap is awaiting its amount (from the
  //     dashboard Swap menu or a bare /wrap //unwrap //swap), capture the next
  //     plain message as the amount. Commands fall through.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId || !swapState.get(userId)) return next();
    if (ctx.message.text.startsWith('/')) {
      swapState.clear(userId);
      return next();
    }
    await handleSwapAmountReply(ctx, ctx.message.text);
  });

  // 2) Commands
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('wallet', handleCreateWallet);
  bot.command('address', handleListAddresses);
  bot.command('balance', handleBalance);
  bot.command('privatekey', handlePrivateKeyCommand);
  bot.command('skip', handleSkip);
  bot.command('wrap', handleWrapCommand);
  bot.command('unwrap', handleUnwrapCommand);
  bot.command('swap', handleSwapCommand);

  // 3) Home-dashboard button taps
  bot.callbackQuery(/^sel:(.+)$/, handleSelectWallet);
  bot.callbackQuery('home:deposit', handleDeposit);
  bot.callbackQuery('home:settings', handleSettings);
  bot.callbackQuery('home:export', handleExport);
  bot.callbackQuery('home:rename', handleChangeName);
  bot.callbackQuery('home:back', handleHomeBack);
  bot.callbackQuery('home:new', handleNewWallet);
  bot.callbackQuery('home:help', handleFaq);
  bot.callbackQuery('home:swap', handleSwapMenu);
  bot.callbackQuery(/^swr:([A-Z]+)_([A-Z]+)$/, handleSwapNew);

  // 4) Wallet-view / key-reveal button taps
  bot.callbackQuery(/^wallet:(.+)$/, handleWalletCallback);
  bot.callbackQuery(/^pk:(.+)$/, handleRevealPrivateKey);
  bot.callbackQuery(/^saved:(.+)$/, handleSavedKey);

  // 4b) Swap confirmation
  bot.callbackQuery('swap:confirm', handleSwapConfirm);
  bot.callbackQuery('swap:cancel', handleSwapCancel);

  // 4c) Deterministic swap-phrase matcher: clear "wrap/unwrap/swap <amount> …"
  //     messages stage a swap directly (always shows Confirm), bypassing the
  //     flaky 7B tool-calling. Anything fuzzy falls through to the AI agent.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseSwapText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageSwap(ctx, userId, parsed);
  });

  // 5) AI agent (F2) — natural-language understanding via 0G Compute.
  //    Runs last so /commands, naming, and button callbacks take precedence.
  bot.on('message:text', handleAiMessage);

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
