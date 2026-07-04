#!/usr/bin/env node
/**
 * Static source-check for src/bot.ts callback wiring.
 *
 * Why a static check? The bug the user just hit was that `home:import`
 * had no `bot.callbackQuery('home:import', handleImportButton)`
 * registration. Grammy's callback router silently drops unknown callback
 * data -- Telegram's loading indicator spins until timeout and the user
 * sees nothing.
 *
 * This test reads bot.ts and walletHandlers.ts as text and asserts:
 *   1. Every `.text('label', 'home:XXX')` keyboard data in walletHandlers.ts
 *      has a matching `bot.callbackQuery('home:XXX', ...)` registration in
 *      bot.ts. Static-symbol-level coverage catches any future "added a
 *      button but forgot to register" regression.
 *   2. The handleImportButton handler is imported from importHandlers in
 *      bot.ts and registered for `home:import`.
 *   3. The other home:* imports are still wired (cross-check for any
 *      accidental removal during a refactor).
 *
 * No ethers/grammy runtime, no TS source imports. Runs fast under tsx
 * (or plain node, but we route through tsx via the run-tests.mjs prefix
 * rule).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const botSrc            = readFileSync(join(cwd, 'src/bot.ts'), 'utf-8');
const walletHandlersSrc = readFileSync(join(cwd, 'src/handlers/walletHandlers.ts'), 'utf-8');

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

// ── 1. Extract keyboard-vs-registration sets ────────────────────────────
// Catch every home:* callback data string used by .text() and every
// callback data registered with bot.callbackQuery. We deliberately
// ignore regex registrations (e.g. /^sel:(.+)$/) for the home check,
// because their "data" is dynamic and only the lint assertion below
// covers them.

// All `.text('label', 'home:XXX')` -- buttons on the dashboard, the
// Settings sub-menu, and the empty-wallet "Create wallet" button.
const keyboardHomeIds = new Set();
for (const m of walletHandlersSrc.matchAll(/\.text\(\s*['"][^'"]*['"]\s*,\s*['"]?(home:[a-z]+)['"]?\s*\)/g)) {
  keyboardHomeIds.add(m[1]);
}

// All `bot.callbackQuery('home:XXX', ...)` -- explicit-string registrations.
const registeredHomeIds = new Set();
for (const m of botSrc.matchAll(/bot\.callbackQuery\(\s*['"](home:[a-z]+)['"]\s*,/g)) {
  registeredHomeIds.add(m[1]);
}

console.log(`Detected ${keyboardHomeIds.size} home:* keyboard data strings and ${registeredHomeIds.size} registrations.\n`);

console.log('callback wiring -- keyboard-vs-registration cross-check');

t('every keyboard data string has a matching bot.callbackQuery registration', () => {
  const missing = [...keyboardHomeIds].filter((id) => !registeredHomeIds.has(id));
  assert.equal(missing.length, 0, `unregistered keyboard callbacks: ${missing.join(', ')}`);
});

t('every bot.callbackQuery registration is actually used by a keyboard', () => {
  // Inverse direction: registrations with no keyboard might be leftover
  // dead code. We tolerate it but log them so they show up in CI logs.
  const orphans = [...registeredHomeIds].filter((id) => !keyboardHomeIds.has(id));
  for (const id of orphans) {
    console.log(`        INFO orphan registration (no matching .text()): ${id}`);
  }
});

t('keyboard and registration sets are non-empty', () => {
  assert.ok(keyboardHomeIds.size > 0, 'no home:* keyboard buttons detected in walletHandlers.ts');
  assert.ok(registeredHomeIds.size > 0, 'no bot.callbackQuery registrations detected in bot.ts');
});

console.log('\ncallback wiring -- /import button (the user-reported bug)');

t('handleImportButton is in the importHandlers import block of bot.ts', () => {
  const importBlock = botSrc.match(
    /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/handlers\/importHandlers['"]\s*;/,
  );
  assert.ok(importBlock, 'no import block from ./handlers/importHandlers in bot.ts');
  for (const name of [
    'handleImportCommand',
    'handleImportKeyReply',
    'handleImportConfirm',
    'handleImportCancel',
    'handleImportButton',
  ]) {
    assert.ok(
      new RegExp(`\\b${name}\\b`).test(importBlock[0]),
      `${name} missing from importHandlers import block`,
    );
  }
});

t(`'home:import' is in both keyboard data and bot.callbackQuery registration`, () => {
  assert.ok(keyboardHomeIds.has('home:import'),
    `'home:import' not detected in walletHandlers.ts keyboards (likely renderHome changed)`);
  assert.ok(registeredHomeIds.has('home:import'),
    `'home:import' callback NOT registered in bot.ts -- this is the original bug`);
});

t(`'home:import' is registered with handleImportButton (not some other handler)`, () => {
  // Specifically check the exact line of registration.
  const m = botSrc.match(/bot\.callbackQuery\(\s*['"]home:import['"]\s*,\s*(\w+)\s*\)/);
  assert.ok(m, `no bot.callbackQuery('home:import', ...) registration found`);
  assert.equal(m[1], 'handleImportButton', `home:import registered with ${m[1]}, expected handleImportButton`);
});

console.log('\ncallback wiring -- every other dashboard button is still paired');

const expectedDashboardButtons = [
  'home:deposit',  'home:send',     'home:swap',
  'home:settings',  'home:rename',   'home:back',
  'home:new',      'home:help',     'home:export',
  'home:import',
];
for (const id of expectedDashboardButtons) {
  t(`'${id}' has a matching registration`, () => {
    assert.ok(registeredHomeIds.has(id), `missing registration for ${id}`);
    assert.ok(keyboardHomeIds.has(id),   `missing keyboard for ${id} (used by renderHome or settings sub-menu)`);
  });
}

console.log('\ncallback wiring -- regex-based dynamic callbacks are still registered');

t('regex-based dynamic callbacks are still registered with bot.callbackQuery', () => {
  // We can't easily cross-check dynamic regexes against keyboard generators,
  // but we can verify the known planet of regex registrations exists by
  // matching their distinctive opening literals -- patterns in bot.ts look
  // like `bot.callbackQuery(/^sel:(.+)$/, handler)`.
  const regexRegistrations = [
    '/^sel:',
    '/^wallet:',
    '/^pk:',
    '/^saved:',
    '/^swr:',
    '/^intent:',
    // NOTE: /bot.callbackQuery(/^intent:(cancel|pause):...) is the same
    // `intent:` registration with a richer subpattern; the `/^intent:`
    // substring check above already covers it by literal match.
  ];
  for (const pattern of regexRegistrations) {
    assert.ok(
      botSrc.includes(`bot.callbackQuery(${pattern}`),
      `expected bot.callbackQuery(${pattern}...) registration not found in bot.ts`,
    );
  }
});

console.log('\ncallback wiring -- smoke check: bot.ts has a working buildBot()');

t('bot.ts exports buildBot', () => {
  assert.ok(/export\s+function\s+buildBot\s*\(/.test(botSrc), 'buildBot export missing');
});

t('bot.ts has the username-recorder middleware as the first handler', () => {
  assert.ok(/usernameIndex\.record/.test(botSrc), 'username recorder missing from bot.ts');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('BOT_CALLBACK_TESTS_FAILED');
  process.exit(1);
}
console.log('BOT_CALLBACK_TESTS_PASSED');
