/**
 * Tests for src/intents/intentStore.ts — LocalStore CRUD.
 *
 * Uses a throwaway file path so the test never touches the real store.
 * The OgFileStore mirror layer is exercised by integration with the rest of
 * the bot, since it requires 0G Storage credentials; we just verify the
 * LocalStore path here so the suite runs in CI without secrets.
 */
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path = join(tmpdir(), `intents-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const mod = await import('../src/intents/intentStore.ts');
const LocalIntentStore = mod.LocalIntentStore;
const newIntentId = mod.newIntentId;

const store = new LocalIntentStore(path);
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label} ${detail}`);
    failed++;
  }
}

const dca = {
  id: newIntentId(),
  userId: '111',
  type: 'dca',
  status: 'active',
  fromToken: 'OG',
  toToken: 'USDC',
  amount: '1',
  schedule: { raw: 'daily', kind: 'interval', intervalMs: 86400000 },
  walletId: 'abcd1234',
  nextRunAt: Date.now() + 60000,
  lastExecutedAt: null,
  createdAt: Date.now(),
};

const alert = {
  id: newIntentId(),
  userId: '222',
  type: 'alert',
  status: 'active',
  symbol: 'OG',
  coingeckoId: 'zero-gravity',
  operator: '<',
  threshold: 1,
  lastCheckedAt: null,
  firedAt: null,
  createdAt: Date.now(),
};

console.log('listAll on empty store');
let list = await store.listAll();
check('returns []', Array.isArray(list) && list.length === 0);

console.log('\nadd + get');
await store.add(dca);
const got = await store.get(dca.id);
check('get returns added intent', got !== null && got.id === dca.id);

console.log('\nadd second, listAll returns both');
await store.add(alert);
list = await store.listAll();
check('listAll returns 2', list.length === 2);

console.log('\nlistForUser filters');
const u1 = await store.listForUser('111');
check('user 111 has 1 intent', u1.length === 1 && u1[0].type === 'dca');
const u2 = await store.listForUser('222');
check('user 222 has 1 intent', u2.length === 1 && u2[0].type === 'alert');
const u3 = await store.listForUser('333');
check('user 333 has 0 intents', u3.length === 0);

console.log('\nupdate');
const updated = await store.update(dca.id, { status: 'paused' });
check('update returns merged intent', updated !== null && updated.status === 'paused');
const re = await store.get(dca.id);
check('persisted update', re.status === 'paused');

console.log('\nupdate with invalid patch returns null');
const bad = await store.update(dca.id, { type: 'alert' });
check('invalid type cast is rejected', bad === null);

console.log('\nremove');
const removed = await store.remove(alert.id);
check('remove returns true', removed === true);
const stillThere = await store.get(alert.id);
check('removed intent is gone', stillThere === null);
const removedAgain = await store.remove(alert.id);
check('second remove returns false', removedAgain === false);

console.log('\nrestart resilience (re-instantiate store, same path)');
const store2 = new LocalIntentStore(path);
const persisted = await store2.listAll();
check('survives re-instantiation', persisted.length === 1 && persisted[0].id === dca.id);

await fs.unlink(path).catch(() => {});

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll intent store checks passed.');
