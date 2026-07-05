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

const { renderReceipt } = await import('../src/proofCenter.ts');
const {
  NftMintReceiptSchema,
  DcaReceiptSchema,
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
  chain: { txHash: NFT_TX_HASH },
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
  chain: { txHash: DCA_TX_HASH },
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
  await t('[nft_mint] Confirmed At cell renders the finalizedAt timestamp', () => {
    // 1700000000000 ms → '2023-11-14 22:13:20 UTC' — check for the date prefix.
    assert.equal(
      html.includes('2023-11-14 22:13:20 UTC'),
      true,
      'expected the Confirmed At timestamp in output',
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
  await t('[dca.executed] Confirmed At cell renders the timestamp (regression guard for the auto_scheduled factory)', () => {
    // 1700000060000 ms → '2023-11-14 22:14:20 UTC' — check for the date prefix.
    assert.equal(
      html.includes('2023-11-14 22:14:20 UTC'),
      true,
      'expected the Confirmed At timestamp in output (would fail if createDcaExecutionReceipt dropped confirmedAt)',
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

// ── Wire check: prove verifyPage actually plumbs the URL rootHash ──────
//
// The renderReceipt-level test above proves the parameter works. But the
// /verify/:root page would still regress to "not yet uploaded" if someone
// reverted the one-line `rootHash` argument at the verifyPage call site.
// Cheap static check on the proofCenter.ts source catches that specific
// regression with a clear failure message.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const proofCenterSource = readFileSync(join(__dirname, '..', 'src', 'proofCenter.ts'), 'utf8');
await t('[wire] verifyPage passes rootHash to renderReceipt (regression guard)', () => {
  assert.equal(
    proofCenterSource.includes('renderReceipt(recovered as IntentReceipt, rootHash)'),
    true,
    'expected verifyPage to call renderReceipt(..., rootHash) — otherwise /verify/:root regresses to "not yet uploaded"',
  );
});

await runNftMint();
await runDcaExecuted();
await runRootHashOverride();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('VERIFY_NFT_MINT_TESTS_FAILED');
  process.exit(1);
}
console.log('VERIFY_NFT_MINT_TESTS_PASSED');
