import { Bot } from 'grammy';
import { config } from './config';
import {
  handleStart,
  handleHelp,
  handleCreateWallet,
  handleNameReply,
  handleSkip,
  handleListAddresses,
  handleWalletCallback,
  handleBalance,
} from './handlers/walletHandlers';
import { naming } from './wallet/namingState';
import { handleAiMessage } from './handlers/aiHandler';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // 1) Naming interceptor: if the user just created a wallet and owes it a name,
  //    capture their next plain message as that name. Commands fall through.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId || !naming.get(userId)) return next();
    if (ctx.message.text.startsWith('/')) {
      naming.clear(userId); // a command instead of a name → keep the default
      return next();
    }
    await handleNameReply(ctx, ctx.message.text);
  });

  // 2) Commands
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('wallet', handleCreateWallet);
  bot.command('address', handleListAddresses);
  bot.command('balance', handleBalance);
  bot.command('skip', handleSkip);

  // 3) Wallet-picker button taps
  bot.callbackQuery(/^wallet:(.+)$/, handleWalletCallback);

  // 4) AI agent (F2) — natural-language understanding via 0G Compute
  bot.on('message:text', handleAiMessage);

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
