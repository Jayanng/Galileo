/**
 * In-process polling worker for the Scheduled Intents Engine.
 *
 *   startIntentWorker({ bot })              // production — uses 30s tick
 *   executeDueIntents({ bot, store, now })  // testable — drive one tick
 *
 * The worker ticks every 30s (configurable), lists every intent in the store,
 * filters to the ones that are due, and runs each through executeIntent. DCA
 * executions are serialized (await between intents) to avoid nonce conflicts
 * on a user's wallet.
 *
 * The worker must be stopped on SIGTERM so an in-flight tick can complete
 * before the process exits. Fly's deploys send SIGTERM, and the index.ts
 * shutdown handler awaits worker.stop().
 */
import { isDue, type Intent } from './types';
import { intentStore, type IntentStore } from './intentStore';
import { executeIntent, type TelegramBot, type ExecuteResult } from './executor';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_INITIAL_DELAY_MS = 5_000;

export interface IntentWorkerDeps {
  bot: TelegramBot;
  /** Defaults to the singleton `intentStore` (local + 0G Storage mirror). */
  store?: IntentStore;
  /** Defaults to `executeIntent` from ./executor. Override in tests. */
  executor?: (intent: Intent, bot: TelegramBot) => Promise<ExecuteResult>;
  /** Polling cadence. Defaults to 30_000 (30s). */
  intervalMs?: number;
  /** Delay before the first tick so bot startup is non-blocking. Defaults to 5_000. */
  initialDelayMs?: number;
}

export interface IntentWorkerHandle {
  /** Clear the interval and await any in-flight tick. */
  stop(): Promise<void>;
  /** Force a tick right now (for tests + manual recovery). Returns processed count. */
  tick(): Promise<number>;
}

/**
 * Scan the store for due intents and run each through the executor in
 * sequence. Returns the number of intents processed. Always updates the store
 * with the executor's returned intent (so nextRunAt / status / firedAt etc.
 * are persisted before the next tick).
 *
 * Exported so tests can drive a single tick deterministically.
 */
export async function executeDueIntents(deps: IntentWorkerDeps & { now?: number }): Promise<number> {
  const store = deps.store ?? intentStore;
  const executor = deps.executor ?? executeIntent;
  const now = deps.now ?? Date.now();

  const intents = await store.listAll();
  const due = intents.filter((i: Intent) => isDue(i, now));
  let processed = 0;
  for (const intent of due) {
    try {
      const result = await executor(intent, deps.bot);
      await store.update(intent.id, result.intent);
      processed++;
    } catch (e) {
      // Executor promises should not throw — this catch is a safety net so
      // one bad intent can't take down the whole tick.
      console.error(`[intents-worker] executor threw for ${intent.id} (${intent.type}):`, e);
    }
  }
  return processed;
}

export function startIntentWorker(deps: IntentWorkerDeps): IntentWorkerHandle {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const initialDelayMs = deps.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let timer: NodeJS.Timeout | null = null;
  let initialTimer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  const runTick = (): Promise<void> => {
    inFlight = (async () => {
      const t0 = Date.now();
      const processed = await executeDueIntents(deps);
      if (processed > 0) {
        console.log(`[intents-worker] tick processed ${processed} intent(s) in ${Date.now() - t0}ms`);
      }
    })();
    return inFlight;
  };

  initialTimer = setTimeout(() => {
    void runTick();
    timer = setInterval(() => {
      void runTick();
    }, intervalMs);
  }, initialDelayMs);

  return {
    stop: async () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      timer = null;
      initialTimer = null;
      if (inFlight) {
        try {
          await inFlight;
        } catch (e) {
          console.warn('[intents-worker] in-flight tick errored during shutdown:', e);
        }
      }
    },
    tick: () => {
      const p = runTick();
      return p.then(() => 0);
    },
  };
}
