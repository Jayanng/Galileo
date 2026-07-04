#!/usr/bin/env node
/**
 * Verification of the `explain_transaction` case in src/ai/toolExecutor.ts.
 *
 * Mirror of scripts/test-tool-executor-explain-contract.mjs — pulls the
 * case-block out of the source and asserts its shape (data envelope, status
 * branches, modelHints, observability). We deliberately do NOT dynamic-import
 * toolExecutor here; the same transitive-imports reason applies (walletService,
 * memory, portfolio, prices, etc.).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const src = readFileSync(join(cwd, 'src/ai/toolExecutor.ts'), 'utf-8');

let pass = 0;
let fail = 0;
function t(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${label}`);
  } catch (e) {
    fail++;
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e?.message ?? JSON.stringify(e)}`);
  }
}

// Pull the case-block: starts at `case 'explain_transaction':`; walks braces
// to find the matching close. (Same approach as the `_contract` test.)
const caseHeader = "case 'explain_transaction':";
const startIdx = src.indexOf(caseHeader);
assert.ok(startIdx > -1, 'no `case \'explain_transaction\':` block in src/ai/toolExecutor.ts');
let depth = 0;
let endIdx = -1;
let sawOpen = false;
for (let i = startIdx; i < src.length; i++) {
  const c = src[i];
  if (c === '{') { depth++; sawOpen = true; }
  else if (c === '}') {
    depth--;
    if (sawOpen && depth === 0) { endIdx = i + 1; break; }
  }
}
assert.ok(endIdx > startIdx, 'could not find end of explain_transaction case');
const caseBlock = src.slice(startIdx, endIdx);

console.log('toolExecutor.explain_transaction — case-block shape');

t('case block is non-trivial (≥500 chars)', () => {
  assert.ok(caseBlock.length >= 500, `case too short: ${caseBlock.length} chars`);
});

t('validates `hash` arg and returns a clear error when missing', () => {
  assert.match(caseBlock, /hash\s*=\s*String\(\s*args\.hash\s*\?\?\s*['"]['"]\s*\)/,
    'no `hash = String(args.hash ?? "")` coercion');
  assert.match(caseBlock, /if\s*\(\s*!hash\s*\)/,
    'no `if (!hash)` guard for missing-arg path');
  const errMatch = caseBlock.match(/error:\s*['"]([^'"]*hash[^'"]*)['"]/);
  assert.ok(errMatch, 'no error string mentioning "hash"');
});

t('calls explainTransaction with the trimmed hash', () => {
  assert.match(caseBlock, /explainTransaction\(\s*hash\s*\)/,
    'no explainTransaction(hash) call');
});

t('returns success:true with the structured data envelope', () => {
  assert.match(caseBlock, /success:\s*true/);
  assert.match(caseBlock, /data:\s*\{/);
});

console.log('\ntoolExecutor.explain_transaction — required data fields');

for (const field of [
  'hash',             // echo for LLM context
  'inputWasValid',    // shape validation
  'status',           // ok | pending | invalid-hash | not-found | rpc-failure
  'found',            // boolean
  'from',
  'to',
  'valueOG',          // human-readable OG
  'gasLimit',
  'gasPrice',
  'functionSelector', // '0xa9059cbb' etc.
  'functionName',     // 'ERC-20 transfer' etc.
  'kind',             // og-transfer / erc20-transfer / wrap / etc.
  'isContractCreation',
  'receipt',          // { status: 'success' | 'reverted', gasUsed, logCount, confirmations }
  'modelHints',
]) {
  t(`data envelope has field '${field}'`, () => {
    const re = new RegExp(`\\b${field}\\b`);
    assert.ok(re.test(caseBlock), `data.${field} missing from explain_transaction case`);
  });
}

console.log('\ntoolExecutor.explain_transaction — modelHints surface');

const requiredHints = [
  'ifSuccess',
  'ifReverted',
  'ifNotFound',
  'ifPending',
  'neverEndorse',
];
for (const key of requiredHints) {
  t(`modelHints has key '${key}'`, () => {
    assert.ok(
      caseBlock.includes(`${key}:`) || caseBlock.includes(`'${key}'`),
      `modelHints.${key} missing`,
    );
  });
}

t('neverEndorse warns against "this looks safe"', () => {
  const m = caseBlock.match(/neverEndorse:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'neverEndorse string literal missing');
  assert.match(m[1], /safe|trust|endorsement/i,
    `neverEndorse text should warn about "safe" / "trust": ${m[1]}`);
});

t('ifReverted explains "the tx failed on-chain"', () => {
  const m = caseBlock.match(/ifReverted:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'ifReverted missing');
  assert.match(m[1], /fail|revert|reverse|on-chain|did not/i,
    `ifReverted text should mention failure: ${m[1]}`);
});

t('ifPending explains "not yet mined"', () => {
  const m = caseBlock.match(/ifPending:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'ifPending missing');
  assert.match(m[1], /pending|not.*yet|mined|mempool/i,
    `ifPending text should mention pending/mined: ${m[1]}`);
});

t('ifNotFound explains "not on 0G chain" without inventing data', () => {
  const m = caseBlock.match(/ifNotFound:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'ifNotFound missing');
  assert.match(m[1], /not.*found|chain|on-chain|don.*t have|fake|made up/i,
    `ifNotFound text shouldn't claim we found it: ${m[1]}`);
});

console.log('\ntoolExecutor.explain_transaction — receipt branching');

t('case distinguishes all four tx outcomes for the LLM', () => {
  // The case passes the receipt object through verbatim — the LLM reads
  // `receipt.status` to decide success-vs-reverted prose.
  assert.match(caseBlock, /receipt:\s*info\.receipt/,
    'case does not propagate `receipt: info.receipt`');
  // modelHints keys cover all branches.
  assert.match(caseBlock, /ifSuccess/, 'no ifSuccess modelHint');
  assert.match(caseBlock, /ifReverted/, 'no ifReverted modelHint');
  assert.match(caseBlock, /ifPending/, 'no ifPending modelHint');
  assert.match(caseBlock, /ifNotFound/, 'no ifNotFound modelHint');
  // The word "reverted" appears literally (in the ifReverted prose).
  assert.match(caseBlock, /reverted/, 'no "reverted" word in case');
});

t('no inline swap/send execution paths', () => {
  // Defence-in-depth: explain_transaction must be read-only. Verify the case
  // does NOT call swapService.prepareSwap / signer.sendTransaction / etc.
  assert.ok(!caseBlock.includes('prepareSwap'),
    'explain_transaction case must NEVER call prepareSwap');
  assert.ok(!caseBlock.includes('sendTransaction'),
    'explain_transaction case must NEVER call sendTransaction');
  assert.ok(!caseBlock.includes('executeSwap'),
    'explain_transaction case must NEVER execute a swap');
});

console.log('\ntoolExecutor.explain_transaction — observability');

t('logs the call with hash + status (substrings OK across case-block)', () => {
  assert.match(caseBlock, /console\.log\(/, 'no console.log call in case');
  assert.match(caseBlock, /\[toolExecutor\]\s*explain_transaction/,
    'log line is missing the `[toolExecutor] explain_transaction …` header');
  assert.match(caseBlock, /hash=/, 'log missing hash= field');
  assert.match(caseBlock, /status=/, 'log missing status= field');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('TOOL_EXECUTOR_EXPLAIN_TRANSACTION_TESTS_FAILED');
  process.exit(1);
}
console.log('TOOL_EXECUTOR_EXPLAIN_TRANSACTION_TESTS_PASSED');
