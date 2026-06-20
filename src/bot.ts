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
} from './handlers/walletHandlers';
import { handleAiMessage } from './handlers/aiHandler';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Commands
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('wallet', handleCreateWallet);
  bot.command('address', handleListAddresses);
  bot.command('balance', handleBalance);
  bot.command('privatekey', handlePrivateKeyCommand);

  // Home-dashboard button taps
  bot.callbackQuery(/^sel:(.+)$/, handleSelectWallet);
  bot.callbackQuery('home:deposit', handleDeposit);
  bot.callbackQuery('home:settings', handleSettings);
  bot.callbackQuery('home:export', handleExport);
  bot.callbackQuery('home:back', handleHomeBack);
  bot.callbackQuery('home:new', handleNewWallet);

  // Wallet-view / key-reveal button taps
  bot.callbackQuery(/^wallet:(.+)$/, handleWalletCallback);
  bot.callbackQuery(/^pk:(.+)$/, handleRevealPrivateKey);
  bot.callbackQuery(/^saved:(.+)$/, handleSavedKey);

  // AI agent (F2) — natural-language understanding via 0G Compute.
  // Runs last so /commands and button callbacks take precedence.
  bot.on('message:text', handleAiMessage);

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
