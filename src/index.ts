import { buildBot } from './bot';
import { config } from './config';
import { operatorWallet } from './og/chain';
import { initializeComputeBroker, getActiveProviderAddress } from './og/computeBroker';
import { startHealthServer } from './health';
import * as usernameIndex from './wallet/usernameIndex';
import { startIntentWorker } from './intents/worker';
import { flushAllPendingUploads } from './ai/memory';

async function main(): Promise<void> {
  const bot = buildBot();

  // Hydrate the @username → userId registry from 0G Storage so `/send @handle`
  // resolves immediately after restart (without this, the index would rebuild
  // from incoming message traffic, leaving a cold-start window where unknown
  // handles fail). Best-effort: when OG_STORAGE_ENABLED=false or the download
  // fails, the in-memory index starts empty and rebuilds organically.
  await usernameIndex.hydrate();

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

  // Health endpoint for uptime monitors (UptimeRobot) and cron pingers (cron-job.org).
  const healthServer = startHealthServer(Number(process.env.PORT) || 8080);

  // Scheduled Intents worker — polls DCA + alert intents every 30s. Runs in
  // the same process as the bot so DCA executions can call the user's wallet
  // without re-loading keys from disk on every tick. The worker is a separate
  // abstraction (startIntentWorker returns a handle) so tests can drive it
  // without booting the full bot.
  const intentWorker = startIntentWorker({ bot });
  console.log('[startup] intents worker armed (30s polling, first tick in 5s)');

  // Graceful shutdown: Fly sends SIGTERM on deploy/restart. Stop polling and exit cleanly
  // so the rejection from bot.start() isn't reported as a fatal crash.
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`[shutdown] ${signal} received, stopping bot + intents worker...`);
    healthServer.close();
    await Promise.all([bot.stop(), intentWorker.stop()]);
    // Flush any memory writes sitting in the debounce window before exiting.
    // Without this, a `fly deploy` would drop the last ~2s of writes. Receipts
    // are unaffected — they upload immediately (not debounced).
    await flushAllPendingUploads(4000);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await bot.start({
      onStart: (info) => console.log(`[startup] bot @${info.username} is running. Press Ctrl+C to stop.`),
    });
  } catch (err) {
    if (!stopping) throw err; // a genuine startup/runtime error
  }
  console.log('[shutdown] stopped cleanly.');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
