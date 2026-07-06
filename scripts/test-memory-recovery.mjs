#!/usr/bin/env node
/**
 * Pure unit tests for src/ai/memory.ts → coerceSnapshot().
 *
 * This file exists because a production incident hit
 *   `TypeError: history.entries.push is not a function`
 * when a user's 0G Storage snapshot was shaped differently from the current
 * `{ entries: MemoryEntry[] }` schema (most likely a stale payload from a
 * previous bot version). `coerceSnapshot()` is the load-time validator that
 * normalises any malformed snapshot to a safe empty history, and these tests
 * are the guardrail that prevents a regression.
 *
 * The tests are pure (no network, no mock framework): they import the helper
 * directly and feed it every plausible malformed shape. If a future code
 * change ever makes coerceSnapshot stop returning a safe array, the
 * `regression: push() never throws` block at the bottom catches it.
 *
 * Run: npm test  (picked up by scripts/run-tests.mjs, routed through tsx)
 */

import assert from 'node:assert/strict';

// Set dummy env BEFORE importing src modules (config.ts zod-validates at
// module load). Mirrors scripts/test-receipt-cancellation.mjs.
process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
process.env.OPERATOR_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.WALLET_ENCRYPTION_KEY = 'a'.repeat(32);
process.env.OG_COMPUTE_API_KEY = 'dummy-key';

const { coerceSnapshot } = await import('../src/ai/memory.ts');

const U = `test-user-${Date.now()}`;
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
let pass = 0;
let fail = 0;

// Silence the expected `[memory] ... invalid shape` warnings this test
// triggers on purpose. We capture them so we can still assert they're
// emitted when expected, but we don't flood the test runner output.
let warnings = [];
const origWarn = console.warn;
console.warn = (...args) => {
  warnings.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
};
function restoreWarn() {
  console.warn = origWarn;
}

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ${PASS} ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ${FAIL} ${name}\n        ${e?.message ?? JSON.stringify(e)}`);
  }
}

const isSafeEmpty = (snap) => {
  assert.ok(Array.isArray(snap.entries), 'entries is an array');
  assert.equal(snap.entries.length, 0, 'entries is empty');
};

console.log(`\n🧪 coerceSnapshot recovery tests (user=${U})\n`);

// ── Valid input: returned by reference, preserves entries ────────────────
{
  const valid = {
    entries: [
      { kind: 'msg', data: { role: 'user', content: 'hi', ts: 1 } },
      { kind: 'tool', data: { tool: 'x', args: {}, result: null, ts: 2 } },
    ],
  };
  const out = coerceSnapshot(valid, U);
  check('valid snapshot is returned by reference (no spurious allocation)', () => {
    assert.equal(out, valid);
  });
  check('valid snapshot preserves entries length', () => {
    assert.equal(out.entries.length, 2);
  });
  check('valid snapshot preserves entry data', () => {
    assert.equal(out.entries[0].data.content, 'hi');
    assert.equal(out.entries[1].data.tool, 'x');
  });
}

// Empty array `entries` is valid
{
  const valid = { entries: [] };
  const out = coerceSnapshot(valid, U);
  check('empty array entries is valid and returned by reference', () => {
    assert.equal(out, valid);
    assert.equal(out.entries.length, 0);
  });
}

// ── Null / undefined / primitives ────────────────────────────────────────
console.log('\n  – null / primitives');
check('null → safe empty snapshot', () => isSafeEmpty(coerceSnapshot(null, U)));
check('undefined → safe empty snapshot', () => isSafeEmpty(coerceSnapshot(undefined, U)));
check('number → safe empty snapshot', () => isSafeEmpty(coerceSnapshot(42, U)));
check('string → safe empty snapshot', () => isSafeEmpty(coerceSnapshot('hello', U)));
check('boolean → safe empty snapshot', () => isSafeEmpty(coerceSnapshot(true, U)));
check('bigint → safe empty snapshot', () => isSafeEmpty(coerceSnapshot(42n, U)));

// ── Object missing entries ──────────────────────────────────────────────
console.log('\n  – malformed objects');
check('{} → safe empty snapshot', () => isSafeEmpty(coerceSnapshot({}, U)));
check('{ entries: undefined } → safe empty snapshot', () => isSafeEmpty(coerceSnapshot({ entries: undefined }, U)));
check('{ entries: null } → safe empty snapshot', () => isSafeEmpty(coerceSnapshot({ entries: null }, U)));

// ── Non-array entries — the actual production bug shape ─────────────────
console.log('\n  – non-array entries (production bug shape)');
check('entries=plain object → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: { foo: 'bar' } }, U)),
);
check('entries=string → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: 'not-an-array' }, U)),
);
check('entries=number → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: 123 }, U)),
);
check('entries=Map → safe empty snapshot', () => {
  const m = new Map();
  m.set('a', 1);
  isSafeEmpty(coerceSnapshot({ entries: m }, U));
});
check('entries=Set → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: new Set([1, 2]) }, U)),
);
check('entries=array-like (length+index, no Array.isArray tag) → safe empty snapshot', () => {
  // arrayLike has numeric length & indices but NOT Array.isArray's [[Class]].
  // In the original production bug, the `entries` value was something OTHER
  // than a real array, which is exactly what this case reproduces.
  const arrayLike = { length: 2, 0: 'a', 1: 'b' };
  isSafeEmpty(coerceSnapshot({ entries: arrayLike }, U));
});
check('entries=Symbol → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: Symbol('s') }, U)),
);
check('entries=function → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot({ entries: () => [] }, U)),
);

// ── Snapshot is itself an array (missing the { entries: [...] } wrapper) ─
console.log('\n  – missing wrapper');
check('snapshot is [] → safe empty snapshot', () => isSafeEmpty(coerceSnapshot([], U)));
check('snapshot is [entry] → safe empty snapshot', () =>
  isSafeEmpty(coerceSnapshot([{ kind: 'msg', data: {} }], U)),
);

// ── THE CRITICAL REGRESSION TEST ────────────────────────────────────────
// The production error was `history.entries.push is not a function`.
// This block proves coerceSnapshot guarantees `.push()` works on the result
// for every malformed input, so an iteration of the AI agent can never
// re-hit this TypeError.
console.log('\n  – regression: .push() never throws on coerced snapshots');

const malformedShapes = [
  ['null', null],
  ['undefined', undefined],
  ['number', 42],
  ['string', 's'],
  ['boolean', true],
  ['bigint', 42n],
  ['{}', {}],
  ['{ entries: undefined }', { entries: undefined }],
  ['[]', []],
  ['{ entries: "x" }', { entries: 'x' }],
  ['{ entries: 123 }', { entries: 123 }],
  ['{ entries: { a: 1 } }', { entries: { a: 1 } }],
  ['{ entries: new Map() }', { entries: new Map() }],
  ['{ entries: new Set() }', { entries: new Set() }],
  ['{ entries: arrayLike }', { entries: { length: 1, 0: 'a' } }],
  ['{ entries: Symbol(s) }', { entries: Symbol('s') }],
  ['{ entries: arrow-fn }', { entries: () => [] }],
];

for (const [label, raw] of malformedShapes) {
  check(`coerceSnapshot(${label}).entries.push(...) does not throw`, () => {
    const out = coerceSnapshot(raw, U);
    out.entries.push({ kind: 'msg', data: { role: 'user', content: 'x', ts: Date.now() } });
    assert.equal(out.entries.length, 1, 'entry was actually pushed');
  });
}

// ── coerceSnapshot itself never throws (defensive contract) ─────────────
console.log('\n  – coerceSnapshot never throws');

const throwingProbes = [Object.create(null), Object.freeze({ entries: 'nope' })];
for (const probe of throwingProbes) {
  check('coerceSnapshot handles frozen/object-without-proto without throwing', () => {
    let out;
    let threw = false;
    try {
      out = coerceSnapshot(probe, U);
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, false, 'coerceSnapshot threw');
    assert.ok(Array.isArray(out.entries));
  });
}

// ── Confirm coerceSnapshot warns on invalid input (and stays silent on valid)
console.log('\n  – warning emission');

// Drain anything captured so far from the section above so we can observe
// just the warnings triggered by THIS probe.
const before = warnings.length;

const invalidSamples = [null, undefined, {}, { entries: 'nope' }, { entries: 123 }];
for (const s of invalidSamples) coerceSnapshot(s, U);
check(
  `coerceSnapshot emitted >=1 warning for ${invalidSamples.length} invalid shapes`,
  () => assert.ok(warnings.length - before >= invalidSamples.length, 'expected at least one warn per invalid shape'),
);

restoreWarn();
const validSample = { entries: [] };
const before2 = warnings.length;
coerceSnapshot(validSample, U);
check('coerceSnapshot did NOT warn on a valid snapshot', () => {
  assert.equal(warnings.length, before2, 'no warning for valid input');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('MEMORY_RECOVERY_TESTS_FAILED');
  process.exit(1);
}
console.log('MEMORY_RECOVERY_TESTS_PASSED');
process.exit(0);
