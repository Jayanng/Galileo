#!/usr/bin/env node
/**
 * Tests for DCA/alert cancellation receipts.
 *
 * Validates that:
 *   1. Cancellation receipt fixtures parse cleanly against their Zod schemas
 *      (DcaReceiptSchema / AlertReceiptSchema) — guards the new 'cancelled'
 *      status + 'intent_found' risk check.
 *   2. renderReceipt() produces correct HTML for cancellation receipts:
 *      - status badge renders "cancelled" with badge-warn class
 *      - Intent Link section renders (links back to creation receipt)
 *      - Confirmed At cell IS present (cancellation uses telegram_inline_button,
 *        not an auto-confirm method — so omitConfirmationTimestamp must be false)
 *      - 'intent_found' + 'user_confirmed' risk checks render
 *      - userIntent.source renders
 *
 * Run: npx tsx scripts/test-receipt-cancellation.mjs
 */

import assert from 'node:assert/strict';

// Set dummy env BEFORE importing any src module (config.ts zod-validates).
process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
process.env.OPERATOR_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.WALLET_ENCRYPTION_KEY = 'a'.repeat(32);
process.env.OG_COMPUTE_API_KEY = 'dummy-key';

const { renderReceipt, omitConfirmationTimestamp } = await import('../src/proofCenter.ts');
const {
  DcaReceiptSchema,
  AlertReceiptSchema,
} = await import('../src/receipts/types.ts');

// ── Fixtures ───────────────────────────────────────────────────────────────

const DCA_CANCEL_TS = 1700000100000;
const DCA_CANCEL_ROOT = '0x' + 'cc'.repeat(32);
const DCA_INTENT_ID = 'dca-cancel-test-001';
const DCA_CREATION_RECEIPT_ID = 'creation-receipt-001';

const dcaCancellationFixture = {
  version: 1,
  receiptId: 'dca-cancel-receipt-001',
  actionType: 'dca',
  userId: '12345',
  status: 'cancelled',
  createdAt: DCA_CANCEL_TS,
  finalizedAt: DCA_CANCEL_TS,
  userIntent: {
    raw: 'Cancel DCA: 1 OG → USDC (every 1 day)',
    source: 'command',
  },
  parsedIntent: {
    type: 'dca',
    fromToken: 'OG',
    toToken: 'USDC',
    amount: '1',
    scheduleRaw: 'every 1 day',
    scheduleIntervalMs: 86400000,
    walletId: 'w-001',
  },
  riskChecks: [
    { check: 'intent_found', status: 'pass', ts: DCA_CANCEL_TS },
    { check: 'user_confirmed', status: 'pass', ts: DCA_CANCEL_TS },
  ],
  compute: null,
  confirmation: {
    required: true,
    method: 'telegram_inline_button',
    confirmedAt: DCA_CANCEL_TS,
  },
  intentLink: {
    intentId: DCA_INTENT_ID,
    creationReceiptId: DCA_CREATION_RECEIPT_ID,
  },
  chain: {},
  storage: { rootHash: DCA_CANCEL_ROOT },
};

const ALERT_CANCEL_TS = 1700000200000;
const ALERT_CANCEL_ROOT = '0x' + 'dd'.repeat(32);
const ALERT_INTENT_ID = 'alert-cancel-test-002';
const ALERT_CREATION_RECEIPT_ID = 'creation-receipt-002';

const alertCancellationFixture = {
  version: 1,
  receiptId: 'alert-cancel-receipt-001',
  actionType: 'alert',
  userId: '67890',
  status: 'cancelled',
  createdAt: ALERT_CANCEL_TS,
  finalizedAt: ALERT_CANCEL_TS,
  userIntent: {
    raw: 'Cancel alert: OG below $1',
    source: 'button',
  },
  parsedIntent: {
    type: 'alert',
    symbol: 'OG',
    coingeckoId: 'zero-gravity',
    operator: '<',
    threshold: 1,
  },
  riskChecks: [
    { check: 'intent_found', status: 'pass', ts: ALERT_CANCEL_TS },
    { check: 'user_confirmed', status: 'pass', ts: ALERT_CANCEL_TS },
  ],
  compute: null,
  confirmation: {
    required: true,
    method: 'telegram_inline_button',
    confirmedAt: ALERT_CANCEL_TS,
  },
  intentLink: {
    intentId: ALERT_INTENT_ID,
    creationReceiptId: ALERT_CREATION_RECEIPT_ID,
  },
  chain: {},
  storage: { rootHash: ALERT_CANCEL_ROOT },
};

// ── Validate fixtures against their Zod schemas ────────────────────────────

function validateFixture(label, schema, fixture) {
  const parsed = schema.safeParse(fixture);
  if (!parsed.success) {
    console.error(`FIXTURE_INVALID (${label}):`, JSON.stringify(parsed.error.issues, null, 2));
    process.exit(1);
  }
  return parsed.data;
}

const dcaParsed = validateFixture('dca.cancelled', DcaReceiptSchema, dcaCancellationFixture);
const alertParsed = validateFixture('alert.cancelled', AlertReceiptSchema, alertCancellationFixture);

// ── Run assertions ─────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
async function t(label, fn) {
  try {
    await fn();
    pass++;
    console.log('  PASS  ' + label);
  } catch (e) {
    fail++;
    console.error('  FAIL  ' + label);
    console.error('        ' + (e?.message ?? JSON.stringify(e)));
  }
}

async function runDcaCancellation() {
  const html = renderReceipt(dcaParsed);
  console.log('\nrenderReceipt(dca.cancelled)');
  await t('[dca.cancel] status badge renders "cancelled" with badge-warn', () => {
    assert.equal(html.includes('badge-warn">cancelled</span>'), true, 'expected cancelled status with badge-warn');
  });
  await t('[dca.cancel] Intent Link section renders with intentId', () => {
    assert.equal(html.includes('Intent Link'), true, 'expected Intent Link section');
    assert.equal(html.includes(DCA_INTENT_ID), true, `expected intentId ${DCA_INTENT_ID}`);
  });
  await t('[dca.cancel] Intent Link shows creation receipt id', () => {
    assert.equal(html.includes(DCA_CREATION_RECEIPT_ID.slice(0, 18)), true, 'expected creation receipt id');
  });
  await t('[dca.cancel] intent_found risk check renders', () => {
    assert.equal(html.includes('intent_found'), true, 'expected intent_found check');
  });
  await t('[dca.cancel] user_confirmed risk check renders', () => {
    assert.equal(html.includes('user_confirmed'), true, 'expected user_confirmed check');
  });
  await t('[dca.cancel] source "command" renders in User Intent', () => {
    assert.equal(html.includes('command'), true, 'expected source=command in User Intent section');
  });
  await t('[dca.cancel] Confirmed At cell IS present (manual confirm, not auto)', () => {
    assert.equal(html.includes('Confirmed At'), true, 'expected Confirmed At cell for telegram_inline_button');
    assert.equal(html.includes('Auto-confirmed'), false, 'did not expect auto-confirm note');
  });
  await t('[dca.cancel] omitConfirmationTimestamp returns false', () => {
    assert.equal(omitConfirmationTimestamp(dcaParsed), false, 'expected false for telegram_inline_button');
  });
  await t('[dca.cancel] Parsed Intent card renders DCA schedule', () => {
    assert.equal(html.includes('every 1 day'), true, 'expected schedule in parsed intent');
  });
  await t('[dca.cancel] root hash renders in Storage card', () => {
    assert.equal(html.includes(DCA_CANCEL_ROOT.slice(0, 20)), true, 'expected rootHash in Storage card');
  });
}

async function runAlertCancellation() {
  const html = renderReceipt(alertParsed);
  console.log('\nrenderReceipt(alert.cancelled)');
  await t('[alert.cancel] status badge renders "cancelled" with badge-warn', () => {
    assert.equal(html.includes('badge-warn">cancelled</span>'), true, 'expected cancelled status with badge-warn');
  });
  await t('[alert.cancel] Intent Link section renders with intentId', () => {
    assert.equal(html.includes('Intent Link'), true, 'expected Intent Link section');
    assert.equal(html.includes(ALERT_INTENT_ID), true, `expected intentId ${ALERT_INTENT_ID}`);
  });
  await t('[alert.cancel] Intent Link shows creation receipt id', () => {
    assert.equal(html.includes(ALERT_CREATION_RECEIPT_ID.slice(0, 18)), true, 'expected creation receipt id');
  });
  await t('[alert.cancel] intent_found risk check renders', () => {
    assert.equal(html.includes('intent_found'), true, 'expected intent_found check');
  });
  await t('[alert.cancel] user_confirmed risk check renders', () => {
    assert.equal(html.includes('user_confirmed'), true, 'expected user_confirmed check');
  });
  await t('[alert.cancel] source "button" renders in User Intent', () => {
    assert.equal(html.includes('button'), true, 'expected source=button in User Intent section');
  });
  await t('[alert.cancel] Confirmed At cell IS present (manual confirm, not auto)', () => {
    assert.equal(html.includes('Confirmed At'), true, 'expected Confirmed At cell for telegram_inline_button');
    assert.equal(html.includes('Auto-confirmed'), false, 'did not expect auto-confirm note');
  });
  await t('[alert.cancel] omitConfirmationTimestamp returns false', () => {
    assert.equal(omitConfirmationTimestamp(alertParsed), false, 'expected false for telegram_inline_button');
  });
  await t('[alert.cancel] Parsed Intent card renders alert condition', () => {
    assert.equal(html.includes('OG'), true, 'expected symbol in parsed intent');
    assert.equal(html.includes('below'), true, 'expected operator word in parsed intent');
  });
  await t('[alert.cancel] root hash renders in Storage card', () => {
    assert.equal(html.includes(ALERT_CANCEL_ROOT.slice(0, 20)), true, 'expected rootHash in Storage card');
  });
}

await runDcaCancellation();
await runAlertCancellation();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('RECEIPT_CANCELLATION_TESTS_FAILED');
  process.exit(1);
}
console.log('RECEIPT_CANCELLATION_TESTS_PASSED');
