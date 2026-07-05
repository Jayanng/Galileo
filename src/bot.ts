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
import { sendState } from './wallet/sendState';
import * as usernameIndex from './wallet/usernameIndex';
import { handleAiMessage } from './handlers/aiHandler';
import { handleProof } from './handlers/proofHandler';
import { handleReceipt } from './handlers/receiptHandler';
import { handlePortfolio, handlePrice, handleHistory } from './handlers/portfolioHandlers';
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
import { handleSendConfirm, handleSendCancel } from './handlers/sendHandlers';
import {
  parseDcaText,
  parseAlertText,
  parseSendScheduleText,
  stageDca,
  stageAlert,
  stageSendSchedule,
} from './handlers/intentUiHandlers';
import {
  handleIntentsCommand,
  handleCancelCommand,
  handlePauseCommand,
  handleIntentCallback,
} from './handlers/intentHandlers';
import {
  handleSendButton,
  handleSendAddressReply,
  handleSendAmountReply,
  handleSendCommand,
  stageSend,
  parseSendText,
} from './handlers/sendUiHandlers';
import {
  handleImportCommand,
  handleImportKeyReply,
  handleImportConfirm,
  handleImportCancel,
  handleImportButton,
} from './handlers/importHandlers';
import { importState } from './wallet/import';

export function buildBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // 0) Username recorder: passively populate the @username → userId index on
  //    every incoming message. Runs first so every later handler still
  //    fires; never short-circuits.
  bot.on('message:text', (ctx, next) => {
    const username = ctx.from?.username;
    const userId = ctx.from?.id != null ? String(ctx.from.id) : null;
    if (username && userId) {
      usernameIndex.record(username, userId);
    }
    return next();
  });

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

  // 1c) Send-state interceptor: when a send is awaiting an address or amount
  //     (from the dashboard Send button or a bare /send), capture the next plain
  //     message. Commands fall through.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const draft = userId ? sendState.get(userId) : undefined;
    if (!userId || !draft) return next();
    if (ctx.message.text.startsWith('/')) {
      sendState.clear(userId);
      return next();
    }
    if (draft.stage === 'address') {
      await handleSendAddressReply(ctx, ctx.message.text);
    } else {
      await handleSendAmountReply(ctx, ctx.message.text);
    }
  });

  // 1d) Import-key interceptor: when an /import is awaiting a private key
  //     (from a bare /import), capture the next plain message as the key.
  //     Commands fall through.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    if (!userId || !importState.isActive(userId)) return next();
    if (ctx.message.text.startsWith('/')) {
      importState.clear(userId);
      return next();
    }
    await handleImportKeyReply(ctx, ctx.message.text);
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
  bot.command('send', handleSendCommand);
  bot.command('import', handleImportCommand);
  bot.command('proof', handleProof);
  bot.command('receipt', handleReceipt);
  bot.command('portfolio', handlePortfolio);
  bot.command('price', handlePrice);
  bot.command('history', handleHistory);
  bot.command('intents', handleIntentsCommand);
  bot.command('cancel', handleCancelCommand);
  bot.command('pause', handlePauseCommand);

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
  bot.callbackQuery('home:send', handleSendButton);

  // 4) Wallet-view / key-reveal button taps
  bot.callbackQuery(/^wallet:(.+)$/, handleWalletCallback);
  bot.callbackQuery(/^pk:(.+)$/, handleRevealPrivateKey);
  bot.callbackQuery(/^saved:(.+)$/, handleSavedKey);

  // 4b) Swap confirmation
  bot.callbackQuery('swap:confirm', handleSwapConfirm);
  bot.callbackQuery('swap:cancel', handleSwapCancel);

  // 4c) Send confirmation
  bot.callbackQuery('send:confirm', handleSendConfirm);
  bot.callbackQuery('send:cancel', handleSendCancel);

  // 4c2) Intent list inline buttons (Cancel / Pause / Resume)
  bot.callbackQuery(/^intent:(cancel|pause):[0-9a-fA-F]+$/, handleIntentCallback);

  // 4c3) Import preview inline buttons (Confirm / Cancel)
  bot.callbackQuery('import:confirm', handleImportConfirm);
  bot.callbackQuery('import:cancel', handleImportCancel);

  // 4c4) Home dashboard "Import wallet" button — kicks off the /import
  //      flow (same handler as the bare /import command, no args).
  bot.callbackQuery('home:import', handleImportButton);

  // 4d) Deterministic swap-phrase matcher: clear "wrap/unwrap/swap <amount> …"
  //     messages stage a swap directly (always shows Confirm), bypassing the
  //     flaky 7B tool-calling. Anything fuzzy falls through to the AI agent.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseSwapText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageSwap(ctx, userId, { ...parsed, rawInput: ctx.message.text, source: 'nl' });
  });

  // 4e) Deterministic send-phrase matcher: "send X OG to 0xADDR" stages a send
  //     directly. Anything else falls through to the AI agent.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseSendText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageSend(ctx, userId, { ...parsed, rawInput: ctx.message.text, source: 'nl' });
  });

  // 4f) Deterministic DCA-phrase matcher: "dca 1 OG into USDC weekly" and
  //     friends stage a DCA directly, bypassing the AI's flaky 7B tool-call.
  //     Falls through to the AI agent on miss (lets the LLM try novel phrasings).
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseDcaText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageDca(ctx, userId, parsed);
  });

  // 4g) Deterministic alert-phrase matcher: "alert me if OG drops below $1"
  //     and friends stage an alert directly. Same fall-through-to-AI semantics.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseAlertText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageAlert(ctx, userId, parsed);
  });

  // 4h) Deterministic recurring-send-phrase matcher: "recurring send 1 OG to @alice weekly"
  //     and "send 0.1 OG to 0xADDR every day" stage a recurring send directly.
  //     Falls through to the AI agent on miss.
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id ? String(ctx.from.id) : null;
    const parsed = userId ? parseSendScheduleText(ctx.message.text) : null;
    if (!userId || !parsed) return next();
    await stageSendSchedule(ctx, userId, parsed);
  });

  // 5) AI agent (F2) — natural-language understanding via 0G Compute.
  //    Runs last so /commands, naming, and button callbacks take precedence.
  bot.on('message:text', handleAiMessage);

  bot.catch((err) => {
    console.error('[bot] error while handling update', err.error);
  });

  return bot;
}
