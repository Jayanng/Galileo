#!/usr/bin/env node
/**
 * Snapshot test for the auto-confirmation rendering used by /verify/:root.
 *
 * Tests TWO fixtures so the method-based auto-confirmation check is genuinely
 * regression-protected (a future revert to an actionType-enumerated list
 * would fail at least one of these):
 *
 *   1. nft_mint         (confirmation.method = 'automatic')
 *   2. dca.executed     (confirmation.method = 'automatic_scheduled')
 *
 * Shared negative assertions:
 *   - No "pending" substring anywhere (no misleading grey badge)
 *   - No `badge-pending` CSS class
 *
 * Per-fixture positive assertions:
 *   - "automatic" present (auto-confirmation rendered)
 *   - chain tx hash present
 *   - finalizedAt timestamp present in the Confirmed At cell
 *
 * Each fixture is validated against its Zod schema before use so a future
 * schema change surfaces here as a clear failure rather than a runtime Zod
 * error in the renderer.
 *
 * Run: npx tsx scripts/test-verify-nft-mint.mjs
 */

import assert from 'node:assert/strict';

// IMPORTANT: set dummy env BEFORE importing proofCenter (it transitively
// imports config.ts which zod-validates required vars). The test only
// exercises the pure renderReceipt function — no env reads.
process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
process.env.OPERATOR_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.WALLET_ENCRYPTION_KEY = 'a'.repeat(32);
process.env.OG_COMPUTE_API_KEY = 'dummy-key';

const { renderReceipt, omitConfirmationTimestamp } = await import('../src/proofCenter.ts');
const {
  NftMintReceiptSchema,
  DcaReceiptSchema,
  SendReceiptSchema,
} = await import('../src/receipts/types.ts');

// ── Fixtures ──────────────────────────────────────────────────────────────

const NFT_TX_HASH = '0x' + '12'.repeat(32);
const NFT_ROOT_HASH = '0x' + '34'.repeat(32);
const NFT_TS = 1700000000000;

const nftMintFixture = {
  version: 1,
  receiptId: 'test-nft-mint-receipt',
  actionType: 'nft_mint',
  userId: '12345',
  status: 'minted',
  createdAt: NFT_TS,
  finalizedAt: NFT_TS,
  userIntent: {
    raw: 'mint profile NFT for Test Wallet (0xab…ab)',
    source: 'automatic',
  },
  parsedIntent: {
    type: 'nft_mint',
    walletId: 'w-001',
    walletName: 'Test Wallet',
    walletAddress: '0x' + 'ab'.repeat(20),
    tokenId: '1',
    tokenURI: '0g://test_root_hash',
    metadataStorageRootHash: 'test_root_hash',
  },
  riskChecks: [
    { check: 'wallet_first_creation', status: 'pass', ts: NFT_TS },
    { check: 'no_existing_profile', status: 'pass', ts: NFT_TS },
    { check: 'metadata_uploaded', status: 'pass', ts: NFT_TS },
  ],
  compute: null,
  confirmation: {
    required: false,
    method: 'automatic',
    confirmedAt: NFT_TS,
  },
  chain: { txHash: NFT_TX_HASH, blockNumber: 12345 },
  storage: { rootHash: NFT_ROOT_HASH },
};

const DCA_TX_HASH = '0x' + '55'.repeat(32);
const DCA_INTENT_ID = 'dca-intent-test-001';
const DCA_TS = 1700000060000;

const dcaExecutedFixture = {
  version: 1,
  receiptId: 'test-dca-executed-receipt',
  actionType: 'dca',
  userId: '67890',
  status: 'executed',
  createdAt: DCA_TS,
  finalizedAt: DCA_TS,
  userIntent: {
    raw: 'DCA execution (automatic): 1 OG → USDC',
    source: 'automatic',
  },
  parsedIntent: {
    type: 'dca',
    fromToken: 'OG',
    toToken: 'USDC',
    amount: '1',
    scheduleRaw: 'every 1 day',
    scheduleIntervalMs: 86400000,
    walletId: 'w-002',
    walletName: 'DCA Wallet',
  },
  riskChecks: [
    { check: 'balance_ok', status: 'pass', ts: DCA_TS },
    { check: 'swap_executed', status: 'pass', ts: DCA_TS },
  ],
  compute: null,
  confirmation: {
    required: false,
    method: 'automatic_scheduled',
    // Auto-scheduled DCA execution has no user Confirm tap, but the F5
    // pipeline observed the on-chain success at a definite moment. The
    // factory sets this with `now` (the moment `emitReceipt` runs, right
    // after `tx.wait()`). Recording the instant here makes the Confirmed At
    // cell render a real timestamp on /verify (auditors can compare against
    // the on-chain block timestamp).
    confirmedAt: DCA_TS,
  },
  intentLink: { intentId: DCA_INTENT_ID },
  chain: { txHash: DCA_TX_HASH, blockNumber: 67890 },
  storage: { rootHash: '0x' + '66'.repeat(32) },
};

// ── Validate fixtures against their Zod schemas ───────────────────────────

function validateFixture(label, schema, fixture) {
  const parsed = schema.safeParse(fixture);
  if (!parsed.success) {
    console.error(`FIXTURE_INVALID (${label}):`, JSON.stringify(parsed.error.issues, null, 2));
    process.exit(1);
  }
  return parsed.data;
}

const nftParsed = validateFixture('nft_mint', NftMintReceiptSchema, nftMintFixture);
const dcaParsed = validateFixture('dca.executed', DcaReceiptSchema, dcaExecutedFixture);

// Minimal send receipt — only used to prove omitConfirmationTimestamp returns
// false for a MANUAL confirmation (telegram_inline_button). Kept inline so
// the omit-helper test stays self-contained and doesn't bloat the shared
// fixtures list.
const sendReceiptFixture = {
  version: 1,
  receiptId: 'test-send-receipt-for-omit-helper',
  actionType: 'send',
  userId: '11111',
  status: 'executed',
  createdAt: NFT_TS,
  finalizedAt: NFT_TS,
  userIntent: { raw: 'send 1 OG to 0xab…ab', source: 'command' },
  parsedIntent: {
    type: 'send',
    amount: '1',
    asset: 'OG',
    recipient: { kind: 'address', value: '0xab', resolvedAddress: '0x' + 'ab'.repeat(20) },
    fromWalletId: 'w-100',
    fromWalletName: 'Main',
  },
  riskChecks: [{ check: 'user_confirmed', status: 'pass', ts: NFT_TS }],
  compute: null,
  confirmation: {
    required: true,
    method: 'telegram_inline_button',
    confirmedAt: NFT_TS,
  },
  chain: { txHash: NFT_TX_HASH },
  storage: {},
};
const sendParsed = validateFixture('send', SendReceiptSchema, sendReceiptFixture);

// ── Run assertions ────────────────────────────────────────────────────────

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

async function runShared(label, html) {
  console.log(`\n[${label}] shared negative assertions`);
  await t(`[${label}] no "pending" substring`, () => {
    assert.equal(html.includes('pending'), false, 'expected no "pending" substring');
  });
  await t(`[${label}] no grey badge-pending CSS class`, () => {
    assert.equal(html.includes('badge-pending'), false, 'expected no badge-pending class');
  });
}

async function runNftMint() {
  const html = renderReceipt(nftParsed);
  console.log('\nrenderReceipt(nft_mint) — fixture 1 of 2');
  await runShared('nft_mint', html);
  console.log('\n[nft_mint] positive markers');
  await t('[nft_mint] "automatic" rendered (auto-confirmation label)', () => {
    assert.equal(html.includes('automatic'), true, 'expected "automatic" substring');
  });
  await t('[nft_mint] chain tx hash rendered', () => {
    assert.equal(html.includes(NFT_TX_HASH), true, `expected ${NFT_TX_HASH} in output`);
  });
  await t('[nft_mint] "2 · Parsed Intent" card is fully omitted', () => {
    assert.equal(html.includes('Parsed Intent'), false, 'expected no "Parsed Intent" substring');
  });
  await t('[nft_mint] auto-confirmation: no "Confirmed At" cell (would just duplicate Created)', () => {
    // For auto-confirmations there's no separate "user pressed Confirm" event,
    // so the Confirmed At cell would just duplicate the Created timestamp. The
    // renderer now hides it and shows a one-line note pointing at the Chain
    // card for the canonical timestamp.
    assert.equal(html.includes('Confirmed At'), false, 'expected no "Confirmed At" label for auto-confirmations');
    assert.equal(
      html.includes('Auto-confirmed'),
      true,
      'expected the auto-confirmation note',
    );
  });
  await t('[nft_mint] Created cell still renders the timestamp (regression guard)', () => {
    assert.equal(
      html.includes('2023-11-14 22:13:20 UTC'),
      true,
      'expected the Created timestamp to remain in the HTML (regression guard for the Created cell)',
    );
  });
  await t('[nft_mint] status badge is "ok" (minted → badge-ok, not the fallback badge-pending)', () => {
    assert.equal(html.includes('badge-ok">minted</span>'), true, 'expected the minted status to render with badge-ok');
  });
}

async function runDcaExecuted() {
  const html = renderReceipt(dcaParsed);
  console.log('\nrenderReceipt(dca.executed) — fixture 2 of 2 (method-based coverage)');
  await runShared('dca.executed', html);
  console.log('\n[dca.executed] positive markers');
  await t('[dca.executed] "automatic" rendered (auto-confirmation label)', () => {
    assert.equal(html.includes('automatic'), true, 'expected "automatic" substring');
  });
  await t('[dca.executed] chain tx hash rendered', () => {
    assert.equal(html.includes(DCA_TX_HASH), true, `expected ${DCA_TX_HASH} in output`);
  });
  await t('[dca.executed] "2 · Parsed Intent" card IS present (dca has schedule metadata)', () => {
    assert.equal(html.includes('2 · Parsed Intent'), true, 'expected the Parsed Intent card for dca');
  });
  await t('[dca.executed] Intent Link section is rendered (dca.executed links back to creation)', () => {
    assert.equal(html.includes('Intent Link'), true, 'expected the Intent Link section');
    assert.equal(html.includes(DCA_INTENT_ID), true, `expected intentId ${DCA_INTENT_ID} in output`);
  });
  await t('[dca.executed] auto-confirmation: no "Confirmed At" cell (would just duplicate Created)', () => {
    assert.equal(html.includes('Confirmed At'), false, 'expected no "Confirmed At" label for auto-confirmations');
    assert.equal(
      html.includes('Auto-confirmed'),
      true,
      'expected the auto-confirmation note (without blockTimestamp it should still render the generic wording)',
    );
    assert.equal(
      html.includes('see Chain below for the on-chain tx'),
      true,
      'expected the generic auto-confirm note when no blockTimestamp is passed',
    );
  });
  await t('[dca.executed] Created cell still renders the timestamp (regression guard)', () => {
    assert.equal(
      html.includes('2023-11-14 22:14:20 UTC'),
      true,
      'expected the Created timestamp to remain in the HTML (regression guard for the Created cell)',
    );
  });
}

// ── Root-hash override parameter test (the /verify/:root bug fix) ──────
//
// The on-Storage receipt never carries its own rootHash (the rootHash IS the
// hash of the receipt — self-reference is meaningless). The /verify/:root page
// passes the URL param as an override to renderReceipt so the Storage cell
// always shows the canonical rootHash. This fixture has empty `storage`
// (matching the on-Storage reality) and we verify the override is what's
// actually rendered.
async function runRootHashOverride() {
  const onStorageLike = {
    ...nftParsed,
    // Simulate what the on-Storage version actually looks like: storage: {}.
    storage: {},
  };
  const OVERRIDE = '0x' + '99'.repeat(32);
  const html = renderReceipt(onStorageLike, OVERRIDE);
  console.log('\nrenderReceipt(nft_mint, override) — fixture 3 (Storage cell fix)');
  await t('[override] Storage cell shows the override rootHash, not "not yet uploaded"', () => {
    assert.equal(html.includes(OVERRIDE.slice(0, 20)), true, 'expected the override rootHash to be rendered in the Storage cell');
    assert.equal(html.includes('not yet uploaded'), false, 'expected no "not yet uploaded" stub when override is provided');
  });
  await t('[override] Receipt self-rootHash is NOT rendered (it was empty in the on-Storage version)', () => {
    // The fixture's own r.storage.rootHash was NFT_ROOT_HASH before we
    // replaced storage with {}, but the on-Storage version never had it. The
    // override is what's canonical.
    assert.equal(html.includes(NFT_ROOT_HASH.slice(0, 20)), false, 'expected the fixture self-rootHash to NOT appear (storage was {} before override)');
  });
  await t('[override] Passing no override falls back to the receipt self-rootHash', () => {
    const fallback = renderReceipt(nftParsed);
    assert.equal(fallback.includes(NFT_ROOT_HASH.slice(0, 20)), true, 'expected the receipt self-rootHash to appear when no override is passed');
  });
  await t('[override] Works the same for dca.executed (parameter is actionType-agnostic)', () => {
    // send, swap, dca.created, dca.executed, alert.armed, alert.fired all hit
    // the same emitReceipt() chicken-and-egg and are auto-fixed by the same
    // parameter. Prove it for the second actionType.
    const dcaOverride = '0x' + 'aa'.repeat(32);
    const dcaHtml = renderReceipt(dcaParsed, dcaOverride);
    assert.equal(
      dcaHtml.includes(dcaOverride.slice(0, 20)),
      true,
      'expected the override rootHash to be rendered in the dca Storage cell',
    );
  });
}

// ── Wire check: prove verifyPage actually plumbs the URL rootHash + blockTimestamp ──────
//
// The renderReceipt-level test above proves the parameter works. But the
// /verify/:root page would still regress to "not yet uploaded" if someone
// reverted the one-line `rootHash` argument at the verifyPage call site,
// or drop the new blockTimestamp from the 3rd arg. Cheap static check on
// the proofCenter.ts source catches both regressions with clear messages.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const proofCenterSource = readFileSync(join(__dirname, '..', 'src', 'proofCenter.ts'), 'utf8');
await t('[wire] verifyPage passes rootHash to renderReceipt (regression guard)', () => {
  assert.equal(
    proofCenterSource.includes('renderReceipt(recovered as IntentReceipt, rootHash, blockTimestamp)'),
    true,
    'expected verifyPage to call renderReceipt(..., rootHash, blockTimestamp) — otherwise /verify/:root regresses to "not yet uploaded"',
  );
});

// ── Block-timestamp parameter (Chain card + auto-confirm note) ──────
//
// The /verify page fetches the canonical on-chain block timestamp via
// provider.getBlock(blockNumber) (5-min cached) and passes it to
// renderReceipt as the 3rd arg. When present, the Chain card renders a
// "Block Timestamp" cell and the auto-confirm note points at it. Without
// it (old receipts without blockNumber, or fetcher failure), neither
// shows up.
async function runBlockTimestamp() {
  console.log('\nrenderReceipt(nft_mint, override, blockTs) — fixture 4 (Chain card fix)');
  const BLOCK_TS = '2024-01-15 10:30:00 UTC';
  const html = renderReceipt(nftParsed, null, BLOCK_TS);
  await t('[blockTs] Chain card renders the Block Timestamp cell when passed', () => {
    assert.equal(html.includes('Block Timestamp'), true, 'expected "Block Timestamp" label in Chain card');
    assert.equal(html.includes(BLOCK_TS), true, `expected the timestamp ${BLOCK_TS} in Chain card`);
  });
  await t('[blockTs] auto-confirm note now points at the on-chain timestamp', () => {
    assert.equal(
      html.includes(`Auto-confirmed on-chain at ${BLOCK_TS}`),
      true,
      'expected the auto-confirm note to reference the block timestamp when present',
    );
  });
  await t('[blockTs] Without blockTimestamp, no Block Timestamp cell and generic auto-confirm note', () => {
    const noTs = renderReceipt(nftParsed);
    assert.equal(noTs.includes('Block Timestamp'), false, 'expected no "Block Timestamp" cell when not passed');
    assert.equal(
      noTs.includes('see Chain below for the on-chain tx'),
      true,
      'expected the generic auto-confirm note when blockTimestamp is absent',
    );
  });
  await t('[blockTs] Works the same for dca.executed (parameter is actionType-agnostic)', () => {
    const DCA_BLOCK_TS = '2024-02-20 14:00:00 UTC';
    const dcaHtml = renderReceipt(dcaParsed, null, DCA_BLOCK_TS);
    assert.equal(dcaHtml.includes('Block Timestamp'), true, 'expected Block Timestamp cell for dca');
    assert.equal(dcaHtml.includes(DCA_BLOCK_TS), true, `expected ${DCA_BLOCK_TS} in dca Chain card`);
    assert.equal(
      dcaHtml.includes(`Auto-confirmed on-chain at ${DCA_BLOCK_TS}`),
      true,
      'expected the dca auto-confirm note to reference the block timestamp',
    );
  });
}

// ── omitConfirmationTimestamp helper (extension point) ──────
//
// This helper is the SINGLE source of truth for "should this receipt show
// a Confirmed At cell?". A future new auto-confirm method added to
// ConfirmationSchema.method MUST extend the OR-list inside the helper
// and add a positive-case assertion here, or /verify will regress to
// showing a Confirmed At cell that just duplicates the Created timestamp.
async function runOmitHelper() {
  console.log('\nrunOmitHelper() — helper-level coverage of the auto-confirm convention');
  await t('[omit] nft_mint (method=automatic) → true', () => {
    assert.equal(omitConfirmationTimestamp(nftParsed), true, 'expected true for automatic');
  });
  await t('[omit] dca.executed (method=automatic_scheduled) → true', () => {
    assert.equal(omitConfirmationTimestamp(dcaParsed), true, 'expected true for automatic_scheduled');
  });
  await t('[omit] send (method=telegram_inline_button) → false (regression guard for the manual path)', () => {
    assert.equal(omitConfirmationTimestamp(sendParsed), false, 'expected false for telegram_inline_button');
  });
}

await runNftMint();
await runDcaExecuted();
await runRootHashOverride();
await runBlockTimestamp();
await runOmitHelper();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('VERIFY_NFT_MINT_TESTS_FAILED');
  process.exit(1);
}
console.log('VERIFY_NFT_MINT_TESTS_PASSED');
