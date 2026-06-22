import { buildBot } from './bot';
import { config } from './config';
import { operatorWallet } from './og/chain';
import { startHealthServer } from './health';

async function main(): Promise<void> {
  const bot = buildBot();

  console.log('[startup] 0G Memory Wallet');
  console.log(`[startup] chain id ${config.OG_CHAIN_ID} via ${config.OG_RPC}`);
  console.log(`[startup] operator wallet ${operatorWallet.address}`);
  console.log(`[startup] 0G Storage persistence: ${config.OG_STORAGE_ENABLED ? 'on' : 'off (local store)'}`);

  // Health endpoint for uptime monitors (UptimeRobot) and cron pingers (cron-job.org).
  const healthServer = startHealthServer(Number(process.env.PORT) || 8080);

  // Graceful shutdown: Fly sends SIGTERM on deploy/restart. Stop polling and exit cleanly
  // so the rejection from bot.start() isn't reported as a fatal crash.
  let stopping = false;
  const shutdown = (signal: string): void => {
    stopping = true;
    console.log(`[shutdown] ${signal} received, stopping bot...`);
    healthServer.close();
    void bot.stop();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

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
