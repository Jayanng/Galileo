import assert from 'node:assert/strict';
import { parseSendText } from './sendUiHandlers';

function eq(a: unknown, b: unknown, msg: string): void {
  assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
}

const ADDR = '0x' + 'a'.repeat(40);

// --- regression: 0x address as recipient ---
eq(
  parseSendText('send 0.1 OG to ' + ADDR),
  { amount: '0.1', to: ADDR },
  'send 0.1 OG to 0x... -> {amount, to}',
);

// --- NEW: @username as recipient (amount then handle) ---
eq(
  parseSendText('send 0.1 OG to @tebasv2'),
  { amount: '0.1', to: '@tebasv2' },
  'send 0.1 OG to @tebasv2 -> {amount, to}',
);

// --- NEW: @username swapped (handle then amount) ---
eq(
  parseSendText('send @tebasv2 0.1'),
  { amount: '0.1', to: '@tebasv2' },
  'send @tebasv2 0.1 -> {amount, to}',
);

// --- NEW: no "send" keyword, no "OG" suffix, just "amount to handle" ---
// (Production regex requires leading "send", so this should be null.)
// We still assert the rejection so the test pinpoints the contract.
assert.equal(
  parseSendText('0.1 OG to @tebasv2'),
  null,
  'no "send" keyword -> null',
);

// --- integer amount ---
eq(
  parseSendText('send 5 to @bobbb'),
  { amount: '5', to: '@bobbb' },
  'send 5 to @bobbb -> {amount:5, to}',
);

// --- preserve mixed-case hex (do not lowercase) ---
const MIXED = '0xAbC' + '0'.repeat(37);
eq(
  parseSendText('send 0.1 OG to ' + MIXED),
  { amount: '0.1', to: MIXED },
  'mixed-case hex address is preserved as-is',
);

// --- negative cases ---
assert.equal(parseSendText('hello world'), null, 'free text -> null');
assert.equal(parseSendText(''), null, 'empty input -> null');
assert.equal(parseSendText('send 0.1'), null, 'no recipient -> null');
assert.equal(parseSendText('send 0.1 to @ab'), null, 'handle too short (<5) -> null');

// --- max length handle (32 chars) ---
const LONG_HANDLE = '@' + 'x'.repeat(32);
const input32 = 'send 0.1 to ' + LONG_HANDLE;
assert.equal(input32.length, 32, 'input string length sanity');
eq(
  parseSendText(input32),
  { amount: '0.1', to: LONG_HANDLE },
  '32-char handle is accepted',
);

console.log('parseSendText: handles 0x, @username, and rejects garbage ✓');
