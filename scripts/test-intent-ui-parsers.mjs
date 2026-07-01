/**
 * Tests for src/handlers/intentUiHandlers.ts — deterministic natural-language
 * parsers for DCA + alert intents. These run BEFORE the AI agent so the common
 * phrasings get parsed without LLM involvement.
 */
import { parseDcaText, parseAlertText } from '../src/handlers/intentUiHandlers.ts';

let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} ${detail}`); failed++; }
}

function eq(actual, expected, fields) {
  for (const f of fields) {
    if (actual?.[f] !== expected[f]) {
      return `${f}: got '${actual?.[f]}' expected '${expected[f]}'`;
    }
  }
  return null;
}

console.log('parseDcaText — common phrasings');

let r = parseDcaText('dca 1 OG into USDC weekly');
check('"dca 1 OG into USDC weekly" matches', r !== null);
check('  amount', eq(r, { amount: '1', fromToken: 'OG', toToken: 'USDC', schedule: 'weekly' }, ['amount', 'fromToken', 'toToken', 'schedule']) === null, eq(r, { amount: '1', fromToken: 'OG', toToken: 'USDC', schedule: 'weekly' }, ['amount', 'fromToken', 'toToken', 'schedule']) ?? '');

r = parseDcaText('dca me 1 OG into USDC weekly');
check('"dca me 1 OG into USDC weekly" matches', r !== null);
check('  amount / schedule', r?.amount === '1' && r?.schedule === 'weekly');

r = parseDcaText('dca 1 OG into USDC every 6 hours');
check('"dca 1 OG into USDC every 6 hours" matches', r !== null);
check('  schedule preserves "every 6 hours"', r?.schedule === 'every 6 hours');

r = parseDcaText('dollar-cost average 1 OG into USDC weekly');
check('"dollar-cost average 1 OG into USDC weekly" matches', r !== null);

r = parseDcaText('dollar cost average 1 OG into USDC weekly');
check('"dollar cost average 1 OG into USDC weekly" matches', r !== null);

r = parseDcaText('recurring swap 1 OG to USDC daily');
check('"recurring swap 1 OG to USDC daily" matches', r !== null);
check('  "to" preposition accepted', r?.toToken === 'USDC');

r = parseDcaText('dca 0.5 OG into USDT every Monday');
check('"dca 0.5 OG into USDT every Monday" matches', r !== null);
check('  fractional amount', r?.amount === '0.5');
check('  weekday schedule preserved', r?.schedule === 'every Monday');

console.log('\nparseDcaText — rejects malformed');

check('"hello world" rejects', parseDcaText('hello world') === null);
check('"dca OG into USDC" (missing amount) rejects', parseDcaText('dca OG into USDC weekly') === null);
check('"dca 1 OG into USDC" (missing schedule) rejects', parseDcaText('dca 1 OG into USDC') === null);
check('"dca 1 OG USDC weekly" (no preposition) rejects', parseDcaText('dca 1 OG USDC weekly') === null);

console.log('\nparseAlertText — verbose phrasings');

r = parseAlertText('alert me if OG drops below $1');
check('"alert me if OG drops below $1" matches', r !== null);
check('  symbol OG', r?.symbol === 'OG');
check('  operator <', r?.operator === '<');
check('  threshold 1', r?.threshold === 1);

r = parseAlertText('alert me when OG goes above $5');
check('"alert me when OG goes above $5" matches', r !== null);
check('  operator >', r?.operator === '>');
check('  threshold 5', r?.threshold === 5);

r = parseAlertText('notify me if bitcoin falls under $30k');
check('"notify me if bitcoin falls under $30k" matches', r !== null);
check('  symbol bitcoin', r?.symbol === 'bitcoin');
check('  operator <', r?.operator === '<');
check('  threshold 30000 (k suffix)', r?.threshold === 30000);

r = parseAlertText('tell me when ETH rises above $3000');
check('"tell me when ETH rises above $3000" matches', r !== null);
check('  symbol ETH', r?.symbol === 'ETH');
check('  operator >', r?.operator === '>');
check('  threshold 3000', r?.threshold === 3000);

r = parseAlertText('alert me if OG is below $1');
check('"alert me if OG is below $1" matches', r !== null);
check('  operator <', r?.operator === '<');

r = parseAlertText('alert me if OG is above $5');
check('"alert me if OG is above $5" matches', r !== null);
check('  operator >', r?.operator === '>');

console.log('\nparseAlertText — compact form');

r = parseAlertText('alert me if OG < $1');
check('"alert me if OG < $1" matches', r !== null);
check('  operator <', r?.operator === '<');

r = parseAlertText('alert me if OG > $5');
check('"alert me if OG > $5" matches', r !== null);
check('  operator >', r?.operator === '>');

r = parseAlertText('alert me if BTC <= $100000');
check('"alert me if BTC <= $100000" matches', r !== null);
check('  operator <=', r?.operator === '<=');

r = parseAlertText('alert me if ETH >= $5000');
check('"alert me if ETH >= $5000" matches', r !== null);
check('  operator >=', r?.operator === '>=');

console.log('\nparseAlertText — k/m/b suffixes');

r = parseAlertText('alert me if ETH is above $5k');
check('"alert me if ETH is above $5k" matches', r !== null);
check('  5k = 5000', r?.threshold === 5000);

r = parseAlertText('alert me if BTC drops below $1m');
check('"alert me if BTC drops below $1m" matches', r !== null);
check('  1m = 1000000', r?.threshold === 1000000);

r = parseAlertText('alert me if AAPL drops below $2.5b');
check('"alert me if AAPL drops below $2.5b" matches', r !== null);
check('  2.5b = 2500000000', r?.threshold === 2.5e9);

console.log('\nparseAlertText — rejects malformed');

check('"hello world" rejects', parseAlertText('hello world') === null);
check('"alert me OG drops below" (no price) rejects', parseAlertText('alert me if OG drops below') === null);
check('"alert me if OG equals $1" (no operator keyword) rejects', parseAlertText('alert me if OG equals $1') === null);
check('"alert me if OG drops below $-5" (negative price) rejects', parseAlertText('alert me if OG drops below $-5') === null);

console.log('\nparseAlertText — fall-through cases (AI gets these)');
check('"ping me when bitcoin moons" falls through', parseAlertText('ping me when bitcoin moons') === null);
check('"OG price alert $1" falls through', parseAlertText('OG price alert $1') === null);
check('"tell me OG is cheap" (no price) falls through', parseAlertText('tell me OG is cheap') === null);

console.log('\nparseDcaText — fall-through cases (AI gets these)');
check('"swap 1 OG for USDC every week" falls through (not a DCA verb)', parseDcaText('swap 1 OG for USDC every week') === null);
check('"invest 1 OG into USDC weekly" falls through (not a known verb)', parseDcaText('invest 1 OG into USDC weekly') === null);

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll intent UI parser checks passed.');
