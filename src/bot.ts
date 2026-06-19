import { Bot } from 'grammy';
import { config } from './config';
import {
  handleStart,
  handleHelp,
  handleCreateWallet,
  handleShowAddress,
  handleBalance,
} from './handlers/walletHandlers';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('wallet', handleCreateWallet);
  bot.command('address', handleShowAddress);
  bot.command('balance', handleBalance);

  // Placeholder natural-language routing. In feature F2 this is replaced by a
  // 0G Compute LLM agent with tool-calling.
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.toLowerCase();
    if (/\b(create|generate|make|new|open)\b.*\bwallet\b/.test(text) || /\bwallet\b.*\bplease\b/.test(text)) {
      return handleCreateWallet(ctx);
    }
    if (/\b(address|receive|deposit)\b/.test(text)) return handleShowAddress(ctx);
    if (/\b(balance|how much|funds)\b/.test(text)) return handleBalance(ctx);
    return ctx.reply(
      [
        "I didn't quite catch that. Try:",
        '• "create me a wallet"',
        '• "show my address"',
        '• "what\'s my balance"',
        '',
        '_(Full natural-language understanding via 0G Compute arrives in feature F2.)_',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
