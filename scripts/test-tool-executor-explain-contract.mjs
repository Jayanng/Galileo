#!/usr/bin/env node
/**
 * Verification of the `explain_contract` case in src/ai/toolExecutor.ts.
 *
 * We deliberately do NOT dynamic-import toolExecutor here — its module
 * pulls in walletService, memory, portfolio, prices, swapService, intents,
 * etc., which transitively load disk files, network providers, etc. The
 * `explain_contract` case is a thin wrapper around explainContract(), and
 * explainContract is exercised by scripts/test-contract-explorer.mjs at
 * the right fidelity.
 *
 * What we DO want to verify here is the SHAPE of the dispatcher output
 * for every status branch, because that's the contract the LLM reads. Read
 * the case-block source and assert it has all the right moves:
 *
 *   • Returns success:true with address, status, isContract, kind, notes,
 *     erc20, isContractText, and modelHints.
 *   • modelHints has all 5 keys: ifKnownAliasPresent, ifTokenButNotKnown,
 *     ifNotAContract, ifRpcFailed, neverEndorse.
 *   • Missing `address` arg produces { success: false, error: … } with a
 *     clear message.
 *   • isContractText has the 3 states (true / false / unknown).
 *
 * This complements test-contract-explorer.mjs by catching breakage in the
 * dispatcher (e.g. if a refactor accidentally drops a modelHints key the
 * LLM relies on).
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
    console.log(`  ✅ ${label}`);
  } catch (e) {
    fail++;
    console.error(`  ❌ ${label}`);
    console.error(`     ${e?.message ?? JSON.stringify(e)}`);
  }
}

// Pull the case-block: starts at `case 'explain_contract': {` and runs to
// the matching `}`. Since the case ends with `}` and the next case starts
// with `case '…':` or `default:`, we look for the block wrapper.
const caseHeader = "case 'explain_contract':";
const startIdx = src.indexOf(caseHeader);
assert.ok(startIdx > -1, 'no `case \'explain_contract\':` block in src/ai/toolExecutor.ts');
// Walk forward, tracking brace depth, until we close the case's brace.
let depth = 0;
let endIdx = -1;
let sawOpen = false;
for (let i = startIdx; i < src.length; i++) {
  const c = src[i];
  if (c === '{') {
    depth++;
    sawOpen = true;
  } else if (c === '}') {
    depth--;
    if (sawOpen && depth === 0) {
      endIdx = i + 1;
      break;
    }
  }
}
assert.ok(endIdx > startIdx, 'could not find end of explain_contract case');
const caseBlock = src.slice(startIdx, endIdx);

console.log('toolExecutor.explain_contract — case-block shape');

t('case block is non-trivial (≥500 chars)', () => {
  assert.ok(caseBlock.length >= 500, `case too short: ${caseBlock.length} chars`);
});

t('validates `address` arg and returns a clear error when missing', () => {
  assert.match(caseBlock, /address\s*=\s*String\(\s*args\.address\s*\?\?\s*['"]['"]\s*\)/,
    'no `address = String(args.address ?? "")` coercion');
  assert.match(caseBlock, /if\s*\(\s*!address\s*\)/,
    'no `if (!address)` guard for missing-arg path');
  // Error message should be human-readable and mention "address" + "0x…".
  const errMatch = caseBlock.match(/error:\s*['"]([^'"]*address[^'"]*)['"]/);
  assert.ok(errMatch, `no error string mentioning "address": ${caseBlock.slice(0, 400)}`);
});

t('calls explainContract with the trimmed address', () => {
  assert.match(caseBlock, /explainContract\(\s*address\s*\)/,
    'no explainContract(address) call');
});

t('returns success:true with the structured data envelope', () => {
  assert.match(caseBlock, /success:\s*true/);
  assert.match(caseBlock, /data:\s*\{/);
});

t('returns every data field the LLM relies on', () => {
  for (const field of [
    'address',         // echo the input for LLM context
    'inputWasValid',   // π
    'status',          // 'ok' | 'invalid-address' | 'rpc-failure'
    'isContract',      // boolean | null
    'isContractText',  // human-readable isContract
    'knownAlias',      // friendly alias or null
    'kind',            // ContractKind or null
    'notes',           // alias notes
    'erc20',           // ERC-20 meta or null
    'modelHints',      // structured guidance for the LLM
  ]) {
    const re = new RegExp(`\\b${field}\\b`);
    assert.ok(re.test(caseBlock), `data.${field} missing from explain_contract dispatch`);
  }
});

console.log('\ntoolExecutor.explain_contract — modelHints surface');

const requiredHints = [
  'ifKnownAliasPresent',
  'ifTokenButNotKnown',
  'ifNotAContract',
  'ifRpcFailed',
  'neverEndorse',
];
for (const key of requiredHints) {
  t(`modelHints has key '${key}'`, () => {
    assert.ok(caseBlock.includes(`${key}:`) || caseBlock.includes(`'${key}'`),
      `modelHints.${key} missing`);
  });
}

t('neverEndorse warns against "this looks safe"', () => {
  // Phrasing varies, but the intent must be visible in the case source.
  const neverEndorse = caseBlock.match(/neverEndorse:\s*['"]([^'"]+)['"]/);
  assert.ok(neverEndorse, 'neverEndorse string literal missing');
  assert.match(neverEndorse[1], /safe|trust|endorsement/i,
    `neverEndorse text should warn about "safe" / "trust": ${neverEndorse[1]}`);
});

t('ifRpcFailed hints at "couldn\'t verify" wording', () => {
  const m = caseBlock.match(/ifRpcFailed:\s*['"]([^'"]+)['"]/);
  assert.ok(m, 'ifRpcFailed missing');
  assert.match(m[1], /verify|rpc|fail/i, `ifRpcFailed text doesn't mention verify / rpc: ${m[1]}`);
});

console.log('\ntoolExecutor.explain_contract — isContractText 3 states');

t('isContractText has 3 branches covering true / false / unknown', () => {
  assert.match(caseBlock, /yes — contract code/i,
    'isContractText is missing the "yes — contract code" branch');
  assert.match(caseBlock, /no — no bytecode/i,
    'isContractText is missing the "no — no bytecode" branch');
  assert.match(caseBlock, /unknown — the RPC/i,
    'isContractText is missing the "unknown — RPC" branch');
});

t('isContractText is wired off info.isContract (not branched on raw bytes)', () => {
  // The conditional should drive off info.isContract:
  // info.isContract === true ? <yes> : info.isContract === false ? <no> : <unknown>
  assert.match(caseBlock, /info\.isContract\s*===\s*true/);
  assert.match(caseBlock, /info\.isContract\s*===\s*false/);
});

console.log('\ntoolExecutor.explain_contract — observability');

t('logs the call with address, isContract, alias, status', () => {
  // The actual line is a multi-line backtick template literal, so we don't
  // rely on a single regex against `console.log(`. Instead, assert the
  // observable contract: the log line lives somewhere in the case, mentions
  // the tool, and includes all four key=value tokens.
  assert.match(caseBlock, /console\.log\(/,
    'no console.log call in case');
  assert.match(caseBlock, /\[toolExecutor\]\s*explain_contract/,
    'log line is missing the `[toolExecutor] explain_contract …` header');
  assert.match(caseBlock, /address=/,
    'log missing address= field');
  assert.match(caseBlock, /isContract=/,
    'log missing isContract= field');
  assert.match(caseBlock, /alias=/,
    'log missing alias= field');
  assert.match(caseBlock, /status=/,
    'log missing status= field');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('TOOL_EXECUTOR_EXPLAIN_CONTRACT_TESTS_FAILED');
  process.exit(1);
}
console.log('TOOL_EXECUTOR_EXPLAIN_CONTRACT_TESTS_PASSED');
