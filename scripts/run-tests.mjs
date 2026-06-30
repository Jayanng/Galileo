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
  const r = spawnSync('node', [full], { stdio: 'inherit' });
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
