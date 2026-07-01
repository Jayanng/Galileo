/**
 * Tests for src/intents/executor.ts — pure helpers + condition evaluation.
 *
 * The chain-touching paths (swapService.executeSwap, bot.api.sendMessage,
 * getPriceUSD, recordTx) are exercised end-to-end by the bot; the unit
 * tests here cover the deterministic parts that don't need a network.
 */
import { parseEther } from 'ethers';
import {
  evaluateAlertCondition,
  isSupportedDcaPath,
  buildDcaPendingSwap,
} from '../src/intents/executor.ts';
import { config } from '../src/config.ts';

let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} ${detail}`); failed++; }
}

console.log('evaluateAlertCondition');
check('5 < 10', evaluateAlertCondition(5, '<', 10) === true);
check('10 < 10', evaluateAlertCondition(10, '<', 10) === false);
check('15 < 10', evaluateAlertCondition(15, '<', 10) === false);
check('15 > 10', evaluateAlertCondition(15, '>', 10) === true);
check('10 > 10', evaluateAlertCondition(10, '>', 10) === false);
check('10 <= 10', evaluateAlertCondition(10, '<=', 10) === true);
check('9.99 <= 10', evaluateAlertCondition(9.99, '<=', 10) === true);
check('10.01 <= 10', evaluateAlertCondition(10.01, '<=', 10) === false);
check('10 >= 10', evaluateAlertCondition(10, '>=', 10) === true);
check('9.99 >= 10', evaluateAlertCondition(9.99, '>=', 10) === false);

console.log('\nisSupportedDcaPath');
const supported = [
  ['OG', 'USDC'],
  ['OG', 'USDT'],
  ['OG', 'WOG'],
  ['WOG', 'OG'],
];
for (const [from, to] of supported) {
  check(`"${from}" → "${to}" supported`, isSupportedDcaPath(from, to));
}
const unsupported = [
  ['USDC', 'WOG'],
  ['WOG', 'USDC'],
  ['USDC', 'OG'],
  ['USDT', 'OG'],
  ['USDC', 'USDT'],
  ['USDT', 'USDC'],
  ['OG', 'OG'],
];
for (const [from, to] of unsupported) {
  check(`"${from}" → "${to}" NOT supported`, isSupportedDcaPath(from, to) === false);
}

console.log('\nbuildDcaPendingSwap — OG → WOG (wrap)');
{
  const intent = {
    id: 'aaa', userId: 'u1', type: 'dca', status: 'active',
    fromToken: 'OG', toToken: 'WOG', amount: '1',
    schedule: { raw: 'daily', kind: 'interval', intervalMs: 86400000 },
    walletId: 'w1', nextRunAt: 0, lastExecutedAt: null, createdAt: 0,
  };
  const p = buildDcaPendingSwap(intent, 'My Wallet');
  check('returns wrap pending', p !== null && !('err' in p) && p.kind === 'wrap');
  if (p && !('err' in p)) {
    check('walletId propagated', p.walletId === 'w1');
    check('walletName propagated', p.walletName === 'My Wallet');
    check('amountWei matches parseEther(1)', p.amountWei === parseEther('1').toString());
    check('summary mentions DCA source', p.summary.includes('daily'));
  }
}

console.log('\nbuildDcaPendingSwap — WOG → OG (unwrap)');
{
  const intent = {
    id: 'bbb', userId: 'u1', type: 'dca', status: 'active',
    fromToken: 'WOG', toToken: 'OG', amount: '0.5',
    schedule: { raw: 'hourly', kind: 'interval', intervalMs: 3600000 },
    walletId: 'w1', nextRunAt: 0, lastExecutedAt: null, createdAt: 0,
  };
  const p = buildDcaPendingSwap(intent, 'Wallet B');
  check('returns unwrap pending', p !== null && !('err' in p) && p.kind === 'unwrap');
  if (p && !('err' in p)) {
    check('fromSymbol is WOG', p.fromSymbol === 'WOG');
    check('toSymbol is OG', p.toSymbol === 'OG');
    check('amountWei matches parseEther(0.5)', p.amountWei === parseEther('0.5').toString());
  }
}

console.log('\nbuildDcaPendingSwap — OG → USDC (dex native-to-token)');
{
  const intent = {
    id: 'ccc', userId: 'u1', type: 'dca', status: 'active',
    fromToken: 'OG', toToken: 'USDC', amount: '2',
    schedule: { raw: 'weekly', kind: 'interval', intervalMs: 604800000 },
    walletId: 'w1', nextRunAt: 0, lastExecutedAt: null, createdAt: 0,
  };
  const p = buildDcaPendingSwap(intent, 'Wallet C');
  check('returns dex pending', p !== null && !('err' in p) && p.kind === 'dex');
  if (p && !('err' in p)) {
    check('routeKind native-to-token', p.routeKind === 'native-to-token');
    check('path is [WOG, USDC]', Array.isArray(p.path) && p.path.length === 2 && p.path[1] === config.USDC_ADDRESS);
    check('path starts with WOG', p.path[0] === config.WOG_ADDRESS);
    check('toSymbol is USDC', p.toSymbol === 'USDC');
  }
}

console.log('\nbuildDcaPendingSwap — OG → USDT (dex native-to-token)');
{
  const intent = {
    id: 'ddd', userId: 'u1', type: 'dca', status: 'active',
    fromToken: 'OG', toToken: 'USDT', amount: '1.5',
    schedule: { raw: 'every 6 hours', kind: 'interval', intervalMs: 21600000 },
    walletId: 'w1', nextRunAt: 0, lastExecutedAt: null, createdAt: 0,
  };
  const p = buildDcaPendingSwap(intent, 'Wallet D');
  check('returns dex pending', p !== null && !('err' in p) && p.kind === 'dex');
  if (p && !('err' in p)) {
    check('toSymbol is USDT', p.toSymbol === 'USDT');
    check('path ends at USDT_ADDRESS', p.path[1] === config.USDT_ADDRESS);
  }
}

console.log('\nbuildDcaPendingSwap — unsupported path returns null');
{
  const intent = {
    id: 'eee', userId: 'u1', type: 'dca', status: 'active',
    fromToken: 'USDC', toToken: 'WOG', amount: '1',
    schedule: { raw: 'daily', kind: 'interval', intervalMs: 86400000 },
    walletId: 'w1', nextRunAt: 0, lastExecutedAt: null, createdAt: 0,
  };
  const p = buildDcaPendingSwap(intent, 'Wallet E');
  check('USDC→WOG returns null', p === null);
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll executor unit checks passed.');
