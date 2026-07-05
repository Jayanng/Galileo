#!/usr/bin/env node
// Test runner: discovers every scripts/test-*.mjs file in lexical order and
// runs it via plain `node`. Prints a banner per file, then a final summary.
// Exit 0 iff every file passed.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = process.cwd();
const dir = join(here, 'scripts');

const files = readdirSync(dir)
  .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
  .sort();

if (files.length === 0) {
  console.log('No test files found in scripts/.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failedNames = [];

for (const f of files) {
  const full = join(dir, f);
  console.log(`\n=== Running: ${f} ===`);
  // Tests that import complex TS source modules (e.g. src/intents/*) need tsx
  // resolution + parameter-property support; plain node strip-only mode can't
  // handle those. Detect by filename prefix and route through the local tsx
  // binary directly (avoids `npx` resolution flakiness in spawned processes).
  // Tests that import complex TS source modules (e.g. src/intents/*) need tsx
  // resolution + parameter-property support; plain node strip-only mode can't
  // handle those. Detect by filename prefix and route through the local tsx
  // binary directly (avoids `npx` resolution flakiness in spawned processes).
  // prefixes cover:
  //   test-intent-*       — intent store / worker / parser / handlers
  //   test-contract-*     — src/og/contractExplorer.ts (ethers mocking)
  //   test-transaction-*  — src/og/transactionExplorer.ts (ethers mocking)
  //   test-help-*         — src/helpContent.ts SSOT rendering
  //   test-bot-*          — src/bot.ts callback wiring (text + tsx for safety)
  //   test-tool-*         — src/ai/toolExecutor.ts case-shape inspection
  const useTsx = /^(test-intent-|test-contract-|test-transaction-|test-help-|test-bot-|test-tool-|test-verify-)/.test(f);
  const tsxBin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  const tsxPath = join(here, 'node_modules', '.bin', tsxBin);
  const cmd = useTsx ? tsxPath : 'node';
  const args = useTsx ? [full] : [full];
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status === 0) {
    passed++;
  } else {
    failed++;
    failedNames.push(f);
  }
}

console.log(`\n--- Summary: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
  console.log(`Failed: ${failedNames.join(', ')}`);
  process.exit(1);
}
process.exit(0);
