import { Bot } from 'grammy';
import { config } from './config';
import {
  handleCreateWallet,
  handleNameReply,
  handleListAddresses,
  handleWalletCallback,
  handleBalance,
  handleHelp,
} from './handlers/walletHandlers';
import { naming } from './wallet/namingState';
import { handleAiMessage } from './handlers/aiHandler';
import { handleProof } from './handlers/proofHandler';
import { handlePortfolio, handlePrice } from './handlers/portfolioHandlers';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // 0) Slash commands. Registered before the naming interceptor so they
  //    take precedence over plain text and never trigger name-capture.
  bot.command('proof', handleProof);
  bot.command('help', handleHelp);
  bot.command('portfolio', handlePortfolio);
  bot.command('price', handlePrice);

  // 1) Naming interceptor: if the user just created a wallet and owes it a name,
  //    capture their next plain message as that name. All input is natural language.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId || !naming.get(userId)) return next();
    // If the user sends a slash command while naming, clear the pending name
    if (ctx.message.text.startsWith('/')) {
      naming.clear(userId);
      return next();
    }
    await handleNameReply(ctx, ctx.message.text);
  });

  // 2) Pure natural language — all input goes through the AI agent
  bot.on('message:text', handleAiMessage);

  // 3) Inline button callbacks: wallet-picker + quick-action buttons
  bot.callbackQuery(/^wallet:(.+)$/, handleWalletCallback);
  bot.callbackQuery(/^action:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.callbackQuery?.data?.replace('action:', '');
    if (!action) return;
    switch (action) {
      case 'balance':
        return handleBalance(ctx);
      case 'addresses':
        return handleListAddresses(ctx);
      case 'wallet':
        return handleCreateWallet(ctx);
      case 'help':
        return handleHelp(ctx);
    }
  });

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
