#!/usr/bin/env node
// Standalone test for parseSendText (extended set). Mirrors
// src/handlers/sendUiHandlers.test.ts but uses plain node (no tsx).

function parseSendText(text) {
  let m = text.match(/^send\s+([\d.]+)\s*(?:og)?\s+to\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\b/i);
  if (m) return { amount: m[1], to: m[2] };
  m = text.match(/^send\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\s+([\d.]+)(?:\s+og)?$/i);
  if (m) return { to: m[1], amount: m[2] };
  return null;
}

let pass = 0;
let fail = 0;

function deepEq(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  if (ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => deepEq(a[k], b[k]));
}

function assertEq(actual, expected, name) {
  const ok = deepEq(actual, expected);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`);
  }
}

const ADDR = '0x' + 'a'.repeat(40);

// 0x regression
assertEq(
  parseSendText('send 0.1 OG to ' + ADDR),
  { amount: '0.1', to: ADDR },
  'send 0.1 OG to 0x... -> {amount, to}',
);

// @username amount-then-handle
assertEq(
  parseSendText('send 0.1 OG to @tebasv2'),
  { amount: '0.1', to: '@tebasv2' },
  'send 0.1 OG to @tebasv2 -> {amount, to}',
);

// swapped
assertEq(
  parseSendText('send @tebasv2 0.1'),
  { amount: '0.1', to: '@tebasv2' },
  'send @tebasv2 0.1 -> {amount, to}',
);

// no "send" keyword
assertEq(
  parseSendText('0.1 OG to @tebasv2'),
  null,
  'no "send" keyword -> null',
);

// integer amount
assertEq(
  parseSendText('send 5 to @bobbb'),
  { amount: '5', to: '@bobbb' },
  'send 5 to @bobbb -> {amount:5, to}',
);

// preserve mixed-case hex
const MIXED = '0xAbC' + '0'.repeat(37);
assertEq(
  parseSendText('send 0.1 OG to ' + MIXED),
  { amount: '0.1', to: MIXED },
  'mixed-case hex address is preserved as-is',
);

// negative cases
assertEq(parseSendText('hello world'), null, 'free text -> null');
assertEq(parseSendText(''), null, 'empty input -> null');
assertEq(parseSendText('send 0.1'), null, 'no recipient -> null');
assertEq(parseSendText('send 0.1 to @ab'), null, 'handle too short (<5) -> null');

// max length handle (32 chars)
const LONG_HANDLE = '@' + 'x'.repeat(32);
assertEq(LONG_HANDLE.length, 33, 'handle (with @) is 33 chars');
assertEq(
  parseSendText('send 0.1 to ' + LONG_HANDLE),
  { amount: '0.1', to: LONG_HANDLE },
  '32-char handle is accepted',
);

console.log('---');
console.log(`passed=${pass} failed=${fail}`);
if (fail === 0) console.log(`ALL_TESTS_PASS (${pass}/${pass})`);
process.exit(fail === 0 ? 0 : 1);
