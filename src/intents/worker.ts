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
 * Ticks use a recursive setTimeout pattern: each tick fully completes before
 * the next one begins. This prevents overlapping ticks that would cause nonce
 * conflicts when two concurrent ticks try to execute the same DCA for the same
 * user. In-flight intent tracking additionally prevents the same intent from
 * being picked up twice across tick boundaries (e.g. when a DCA's schedule is
 * shorter than the tick interval plus execution time).
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

  // Track intent IDs currently being executed so concurrent ticks (from the
  // recursive setTimeout pattern below) don't process the same intent twice.
  // This mainly protects against DCAs with schedules shorter than the tick
  // interval + execution time, where nextRunAt hasn't been updated yet when
  // the next tick checks for due intents.
  const inFlightIntents = new Set<string>();

  // Wrap the executor to skip intents already being processed by another tick.
  // When skipping, return the intent unchanged so store.update is a no-op.
  const wrappedExecutor = async (
    intent: Intent,
    bot: TelegramBot,
  ): Promise<ExecuteResult> => {
    if (inFlightIntents.has(intent.id)) {
      return { intent };
    }
    inFlightIntents.add(intent.id);
    try {
      return await (deps.executor ?? executeIntent)(intent, bot);
    } finally {
      inFlightIntents.delete(intent.id);
    }
  };

  const depsWithGuard = { ...deps, executor: wrappedExecutor };

  const runTick = (): Promise<void> => {
    inFlight = (async () => {
      const t0 = Date.now();
      const processed = await executeDueIntents(depsWithGuard);
      if (processed > 0) {
        console.log(`[intents-worker] tick processed ${processed} intent(s) in ${Date.now() - t0}ms`);
      }
    })();
    return inFlight;
  };

  // Use recursive setTimeout so each tick fully completes before the next one
  // begins. This prevents overlapping ticks that cause nonce conflicts when
  // two concurrent ticks try to execute the same DCA for the same wallet.
  // The intervalMs delay is measured from tick completion to next tick start.
  // Each tick is wrapped in try/catch so a transient failure (e.g. RPC error,
  // filesystem hiccup) does not permanently stop the worker from ticking.
  const scheduleNext = (): void => {
    timer = setTimeout(async () => {
      try {
        await runTick();
      } catch (e) {
        console.error('[intents-worker] tick failed, scheduling next:', e);
      }
      scheduleNext();
    }, intervalMs);
  };

  initialTimer = setTimeout(async () => {
    try {
      await runTick();
    } catch (e) {
      console.error('[intents-worker] initial tick failed, scheduling next:', e);
    }
    scheduleNext();
  }, initialDelayMs);

  return {
    stop: async () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (timer) clearTimeout(timer);
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
