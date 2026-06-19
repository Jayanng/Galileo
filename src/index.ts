import { buildBot } from './bot';
import { config } from './config';
import { operatorWallet } from './og/chain';

async function main(): Promise<void> {
  const bot = buildBot();

  console.log('[startup] 0G Memory Wallet');
  console.log(`[startup] chain id ${config.OG_CHAIN_ID} via ${config.OG_RPC}`);
  console.log(`[startup] operator wallet ${operatorWallet.address}`);
  console.log(`[startup] 0G Storage persistence: ${config.OG_STORAGE_ENABLED ? 'on' : 'off (local store)'}`);

  process.once('SIGINT', () => void bot.stop());
  process.once('SIGTERM', () => void bot.stop());

  await bot.start({
    onStart: (info) => console.log(`[startup] bot @${info.username} is running. Press Ctrl+C to stop.`),
  });
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
