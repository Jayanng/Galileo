#!/usr/bin/env node
// Standalone test for usernameIndex — inlined logic so we can run via plain
// `node` (no TS compilation, no ethers, no tsx). Mirrors
// src/wallet/usernameIndex.test.ts.

const index = new Map();

function normalize(username) {
  const trimmed = String(username).trim();
  if (!trimmed) return null;
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const lowered = stripped.toLowerCase();
  return lowered.length > 0 ? lowered : null;
}

function record(username, userId) {
  const key = username == null ? null : normalize(username);
  if (!key) return;
  index.set(key, { userId, lastSeen: Date.now() });
}

function lookup(username) {
  const key = normalize(username);
  if (!key) return null;
  return index.get(key)?.userId ?? null;
}

function count() { return index.size; }
function clear() { index.clear(); }

let pass = 0;
let fail = 0;

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`);
  }
}

// 1) fresh + record/lookup case-insensitive
clear();
assertEq(count(), 0, 'fresh index is empty');
record('@Alice', 'user-1');
assertEq(lookup('alice'), 'user-1', 'lowercase lookup matches stored mixed-case key');

// 2) leading @ stripped on lookup
record('@Bob', 'user-2');
assertEq(lookup('@bob'), 'user-2', 'leading @ is stripped on lookup');

// 3) whitespace trimmed
record('  Carol ', 'user-3');
assertEq(lookup('carol'), 'user-3', 'surrounding whitespace is trimmed');

// 4) last writer wins
record('@Dave', 'user-4');
record('@Dave', 'user-5');
assertEq(lookup('dave'), 'user-5', 'second record overwrites first');

assertEq(count(), 4, 'four distinct keys are tracked');

// 5) null/empty/whitespace username is a no-op
record(null, 'user-x');
record('', 'user-x');
record('   ', 'user-x');
assertEq(count(), 4, 'null/empty/whitespace username does not add a key');
assertEq(lookup(''), null, 'empty lookup is null');
assertEq(lookup('   '), null, 'whitespace-only lookup is null');
assertEq(lookup('user-x'), null, 'no key was ever stored for "user-x"');

// 6) clear()
clear();
assertEq(count(), 0, 'clear empties the index');
assertEq(lookup('alice'), null, 'lookup after clear is null');
assertEq(lookup('@bob'), null, 'lookup after clear is null');

console.log('---');
console.log(`passed=${pass} failed=${fail}`);
if (fail === 0) console.log(`ALL_TESTS_PASS (${pass}/${pass})`);
process.exit(fail === 0 ? 0 : 1);
