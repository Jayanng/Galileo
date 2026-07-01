/**
 * Tests for src/intents/worker.ts — drives executeDueIntents directly with a
 * stubbed executor and a LocalIntentStore fixture so the worker logic
 * (filtering, sequencing, store update) is verified without any network.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeDueIntents } from '../src/intents/worker.ts';
import { LocalIntentStore } from '../src/intents/intentStore.ts';

let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} ${detail}`); failed++; }
}

const storePath = join(tmpdir(), `worker-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const store = new LocalIntentStore(storePath);

const now = 1_700_000_000_000; // fixed reference time

const intent = (id, userId, type, status, nextRunAt, extras = {}) => ({
  id, userId, type, status,
  ...(type === 'dca'
    ? {
        fromToken: 'OG', toToken: 'USDC', amount: '1',
        schedule: { raw: 'daily', kind: 'interval', intervalMs: 86400000 },
        walletId: 'w1',
        nextRunAt, lastExecutedAt: null, createdAt: now - 86400000,
      }
    : {
        symbol: 'OG', coingeckoId: 'zero-gravity', operator: '<', threshold: 1,
        lastCheckedAt: null, firedAt: null, createdAt: now - 3600000,
      }),
  ...extras,
});

// Seed the store with a mix of due + not-due + non-active intents.
await store.add(intent('aaa', 'u1', 'dca', 'active', now - 1000));         // due DCA
await store.add(intent('bbb', 'u1', 'dca', 'active', now + 60000));        // future DCA
await store.add(intent('ccc', 'u2', 'dca', 'paused', now - 1000));         // paused DCA, due by time but skipped
await store.add(intent('ddd', 'u2', 'alert', 'active', 0));                // active alert
await store.add(intent('eee', 'u3', 'alert', 'fired', 0));                 // fired alert, skipped

let executed = [];
const stubBot = { api: { sendMessage: async () => undefined } };
const stubExecutor = async (i) => {
  executed.push(i.id);
  // Simulate a DCA: bump nextRunAt out by 1 day. Simulate an alert: mark fired.
  if (i.type === 'dca') {
    return { intent: { ...i, nextRunAt: now + 86400000, lastExecutedAt: now } };
  }
  return { intent: { ...i, status: 'fired', firedAt: now, lastCheckedAt: now } };
};

console.log('executeDueIntents — filters active + due');
executed = [];
const n = await executeDueIntents({ bot: stubBot, store, executor: stubExecutor, now });
check('processed exactly 2 intents (aaa DCA + ddd alert)', n === 2);
check('aaa was executed', executed.includes('aaa'));
check('ddd was executed', executed.includes('ddd'));
check('bbb (future) was NOT executed', !executed.includes('bbb'));
check('ccc (paused) was NOT executed', !executed.includes('ccc'));
check('eee (fired) was NOT executed', !executed.includes('eee'));

console.log('\nstate was persisted to store');
const after = await store.listAll();
const aaa = after.find((i) => i.id === 'aaa');
check('aaa.nextRunAt bumped', aaa?.nextRunAt === now + 86400000);
check('aaa.lastExecutedAt set', aaa?.lastExecutedAt === now);
const ddd = after.find((i) => i.id === 'ddd');
check('ddd.status flipped to fired', ddd?.status === 'fired');
check('ddd.firedAt set', ddd?.firedAt === now);
check('ddd.lastCheckedAt set', ddd?.lastCheckedAt === now);

console.log('\nidempotency — re-ticking does not double-fire');
executed = [];
const n2 = await executeDueIntents({ bot: stubBot, store, executor: stubExecutor, now });
check('second tick at same now processes 0', n2 === 0);

console.log('\nnoop — empty store returns 0');
const emptyStore = new LocalIntentStore(join(tmpdir(), `empty-${Date.now()}.json`));
const n3 = await executeDueIntents({ bot: stubBot, store: emptyStore, executor: stubExecutor, now });
check('empty store processes 0', n3 === 0);

console.log('\nfailure isolation — one executor throw does not stop the rest');
const bombStore = new LocalIntentStore(join(tmpdir(), `bomb-${Date.now()}.json`));
await bombStore.add(intent('g1', 'u9', 'dca', 'active', now - 1000));
await bombStore.add(intent('g2', 'u9', 'dca', 'active', now - 1000));
const bombExecutor = async (i) => {
  if (i.id === 'g1') throw new Error('boom');
  return { intent: { ...i, nextRunAt: now + 86400000, lastExecutedAt: now } };
};
const n4 = await executeDueIntents({ bot: stubBot, store: bombStore, executor: bombExecutor, now });
// processed counts only successes; the worker logs the throw and keeps ticking.
check('returns 1 (only g2 succeeded; g1 threw and was logged)', n4 === 1);
const g1After = (await bombStore.listAll()).find((i) => i.id === 'g1');
const g2After = (await bombStore.listAll()).find((i) => i.id === 'g2');
check('g1 was NOT updated (executor threw before store.update)', g1After?.lastExecutedAt === null);
check('g2 was still updated despite g1 throw', g2After?.lastExecutedAt === now);

await fs.unlink(storePath).catch(() => {});
await fs.unlink(join(tmpdir(), `empty-${Date.now()}.json`)).catch(() => {});
await fs.unlink(join(tmpdir(), `bomb-${Date.now()}.json`)).catch(() => {});

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll worker checks passed.');
