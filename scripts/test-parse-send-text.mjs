#!/usr/bin/env node
// Standalone test for parseSendText — inlined logic so we can run via plain `node`
// (no TS compilation step needed).

function parseSendText(text) {
  let m = text.match(/^send\s+([\d.]+)\s*(?:og)?\s+to\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\b/i);
  if (m) return { amount: m[1], to: m[2] };
  m = text.match(/^send\s+(0x[0-9a-fA-F]{40}|@[A-Za-z0-9_]{5,32})\s+([\d.]+)(?:\s+og)?$/i);
  if (m) return { to: m[1], amount: m[2] };
  return null;
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const ADDR = '0x' + 'a'.repeat(40);

const cases = [
  // --- existing 0x cases ---
  ['send 0.1 OG to ' + ADDR, ADDR, '0.1', true],
  ['send 0.1 to ' + ADDR, ADDR, '0.1', true],
  ['send ' + ADDR + ' 0.1', ADDR, '0.1', true],
  // --- new @username cases ---
  ['send 0.1 OG to @tebasv2', '@tebasv2', '0.1', true],
  ['send 5 to @tebasv2', '@tebasv2', '5', true],
  ['send @tebasv2 2.5', '@tebasv2', '2.5', true],
  ['send @alice 0 OG', '@alice', '0', true],
  // --- negative cases ---
  ['send 0.1 to @bob', null, null, false],          // @bob is 4 chars (< 5) -> should NOT match
  ['send 0xXYZ 1.0', null, null, false],            // malformed 0x address
  ['swap 0.1 OG to ' + ADDR, null, null, false],    // wrong verb
];

let passed = 0;
const total = cases.length;

for (const [input, expectedTo, expectedAmount, expectedNonNull] of cases) {
  const got = parseSendText(input);
  const isNonNull = got !== null;
  const okNonNull = isNonNull === expectedNonNull;
  const okTo = got && expectedTo ? got.to === expectedTo : deepEq(got && got.to, expectedTo);
  const okAmt = got && expectedAmount ? got.amount === expectedAmount : deepEq(got && got.amount, expectedAmount);
  const ok = okNonNull && okTo && okAmt;

  if (ok) {
    passed++;
    console.log(`PASS: ${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
  } else {
    console.log(
      `FAIL: ${JSON.stringify(input)}\n  got=${JSON.stringify(got)}\n  expectedNonNull=${expectedNonNull} expectedTo=${JSON.stringify(expectedTo)} expectedAmount=${JSON.stringify(expectedAmount)}`,
    );
  }
}

if (passed === total) {
  console.log(`ALL_TESTS_PASS (${passed}/${total})`);
  process.exit(0);
} else {
  console.log(`TESTS_FAILED (${passed}/${total})`);
  process.exit(1);
}
