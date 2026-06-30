import { buildBot } from './bot';
import { config } from './config';
import { operatorWallet } from './og/chain';
import { initializeComputeBroker, getActiveProviderAddress } from './og/computeBroker';

async function main(): Promise<void> {
  const bot = buildBot();

  console.log('[startup] 0G Memory Wallet');
  console.log(`[startup] chain id ${config.OG_CHAIN_ID} via ${config.OG_RPC}`);
  console.log(`[startup] operator wallet ${operatorWallet.address}`);
  console.log(`[startup] 0G Storage persistence: ${config.OG_STORAGE_ENABLED ? 'on' : 'off (local store)'}`);

  // Initialize the 0G Compute Network broker (provider discovery, signer
  // acknowledgement, optional sub-account top-up). If this fails:
  //   - In fallback mode (OG_COMPUTE_FALLBACK=true) we log a warning and
  //     continue; every AI reply will carry a "verification unavailable" footer.
  //   - Otherwise we re-throw and refuse to start, because shipping
  //     unverifiable inference silently is worse than refusing to boot.
  try {
    await initializeComputeBroker();
    const provider = getActiveProviderAddress();
    if (provider) {
      console.log(`[startup] 0G Compute broker ready · provider=${provider} · model=${config.OG_COMPUTE_MODEL}`);
    }
  } catch (e) {
    if (config.OG_COMPUTE_FALLBACK) {
      console.warn(
        `[startup] 0G Compute broker init failed; continuing in fallback mode: ${(e as Error).message}`,
      );
    } else {
      throw e;
    }
  }

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
