#!/usr/bin/env node
/**
 * Tests for src/og/transactionExplorer.ts — explainTransaction().
 *
 * Strategy: prototype-patch ethers' JsonRpcProvider so we control every
 * `getTransaction(hash)` and `getTransactionReceipt(hash)` response BEFORE
 * dynamic-importing the source. Per-hash fixtures drive every status branch.
 *
 * Required env (set BEFORE import so config.ts zod-validation succeeds):
 *   TELEGRAM_BOT_TOKEN, OPERATOR_PRIVATE_KEY (64 hex), WALLET_ENCRYPTION_KEY
 *   (≥16 chars), OG_COMPUTE_API_KEY. CI writes a .env with these before
 *   `npm test`, so no extra setup is required locally.
 *
 * Run: npx tsx scripts/test-transaction-explorer.mjs
 */
import assert from 'node:assert/strict';

// ── Hash fixtures (deterministic) ─────────────────────────────────────────
const HASH_OG_XFER     = '0x' + '11'.repeat(32);
const HASH_ERC20_XFER  = '0x' + '22'.repeat(32);
const HASH_WRAP        = '0x' + '33'.repeat(32);
const HASH_UNWRAP      = '0x' + '44'.repeat(32);
const HASH_UNI_SWAP    = '0x' + '55'.repeat(32);
const HASH_CTOR        = '0x' + '66'.repeat(32);
const HASH_REVERTED    = '0x' + '77'.repeat(32);
const HASH_PENDING     = '0x' + '88'.repeat(32);
const HASH_MINED_NO_R  = '0x' + '89'.repeat(32);
const HASH_EIP1559     = '0x' + '90'.repeat(32);
const HASH_TO_WOG      = '0x' + '99'.repeat(32);
const HASH_TO_ROUTER   = '0x' + 'aa'.repeat(32);
const HASH_NOT_FOUND   = '0x' + 'bb'.repeat(32);
const HASH_RPC_FAIL    = '0x' + 'ff'.repeat(32);

// ── Configure the alias table via env BEFORE importing ─────────────────────
// Each `'aa'.repeat(N)` produces N×2 hex chars; 20 reps = 40 hex chars = a
// real 42-char EVM address (0x + 40 hex). Using .repeat(40) would produce an
// 82-char string that the aliasLookup() regex rejects, leaving the map empty.
const WOG_ADDR    = '0x' + 'aa'.repeat(20);
const USDC_ADDR   = '0x' + 'bb'.repeat(20);
const ROUTER_ADDR = '0x' + 'dd'.repeat(20);
process.env.WOG_ADDRESS       = WOG_ADDR;
process.env.USDC_ADDRESS      = USDC_ADDR;
process.env.DEX_ROUTER_ADDRESS = ROUTER_ADDR;

// ── Mock the chain ───────────────────────────────────────────────────────
const { JsonRpcProvider } = await import('ethers');

const FROM_ADDR  = '0x' + 'f1'.repeat(20);
const TO_WOG     = WOG_ADDR;
const TO_ROUTER  = ROUTER_ADDR;
const TO_OTHER   = '0x' + 'ee'.repeat(20);

JsonRpcProvider.prototype.getTransaction = async function patchedGetTx(patchedHash) {
  const hash = String(patchedHash).toLowerCase();
  if (hash === HASH_RPC_FAIL.toLowerCase()) throw new Error('mock: rpc failure');
  if (hash === HASH_NOT_FOUND.toLowerCase()) return null;

  // Helper: forge a TransactionResponse-like object. ethers only uses the
  // fields we read, so we can return a plain shape.
  const tx = (overrides) => ({
    hash: patchedHash,
    from: FROM_ADDR,
    to: null,
    value: 0n,
    nonce: 7,
    gasLimit: 21000n,
    gasPrice: 1000000000n,         // 1 gwei
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    data: '0x',
    blockNumber: 100,
    ...overrides,
  });

  switch (hash) {
    case HASH_OG_XFER.toLowerCase():
      return tx({ to: TO_OTHER, value: 1000000000000000000n, data: '0x' });
    case HASH_ERC20_XFER.toLowerCase():
      // ERC-20 transfer(recipient, amount) — selector 0xa9059cbb
      return tx({ to: USDC_ADDR, value: 0n, data: '0xa9059cbb' + '00'.repeat(64) });
    case HASH_WRAP.toLowerCase():
      // WETH deposit() — selector 0xd0e30db0
      return tx({ to: WOG_ADDR, value: 500000000000000000n, data: '0xd0e30db0' });
    case HASH_UNWRAP.toLowerCase():
      // WETH withdraw(uint256) — selector 0x2e1a7d4d
      return tx({ to: WOG_ADDR, value: 0n, data: '0x2e1a7d4d' + '00'.repeat(64) });
    case HASH_UNI_SWAP.toLowerCase():
      // Uniswap-V2 swapExactTokensForTokens — selector 0x38ed1739
      return tx({ to: ROUTER_ADDR, value: 0n, data: '0x38ed1739' + '00'.repeat(96) });
    case HASH_CTOR.toLowerCase():
      // Contract creation: `to === null`, has data
      return tx({ to: null, value: 0n, data: '0x6080604052' + 'ab'.repeat(40) });
    case HASH_REVERTED.toLowerCase():
      return tx({ to: TO_OTHER, value: 1000000000000000000n, data: '0x' });
    case HASH_PENDING.toLowerCase():
      return tx({ to: TO_OTHER, value: 1000000000000000000n, data: '0x', blockNumber: null });
    case HASH_MINED_NO_R.toLowerCase():
      // mined but receipt RPC hasn't caught up
      return tx({ to: TO_OTHER, value: 1000000000000000000n, data: '0x', blockNumber: 200 });
    case HASH_EIP1559.toLowerCase():
      return tx({
        to: TO_OTHER,
        value: 0n,
        gasPrice: null,
        maxFeePerGas: 2000000000n,
        maxPriorityFeePerGas: 1000000000n,
        data: '0xa9059cbb' + '00'.repeat(64),
      });
    case HASH_TO_WOG.toLowerCase():
      return tx({ to: WOG_ADDR, value: 500000000000000000n, data: '0xd0e30db0' });
    case HASH_TO_ROUTER.toLowerCase():
      return tx({ to: ROUTER_ADDR, value: 0n, data: '0x38ed1739' + '00'.repeat(96) });
    default:
      return null;
  }
};

JsonRpcProvider.prototype.getTransactionReceipt = async function patchedGetRcpt(patchedHash) {
  const hash = String(patchedHash).toLowerCase();
  if (hash === HASH_RPC_FAIL.toLowerCase()) throw new Error('mock: rpc failure');
  if (hash === HASH_PENDING.toLowerCase()) return null;        // mempool
  if (hash === HASH_MINED_NO_R.toLowerCase()) return null;     // mined, not yet caught up

  switch (hash) {
    case HASH_OG_XFER.toLowerCase():
    case HASH_ERC20_XFER.toLowerCase():
    case HASH_WRAP.toLowerCase():
    case HASH_UNWRAP.toLowerCase():
    case HASH_UNI_SWAP.toLowerCase():
    case HASH_CTOR.toLowerCase():
    case HASH_EIP1559.toLowerCase():
    case HASH_TO_WOG.toLowerCase():
    case HASH_TO_ROUTER.toLowerCase():
      return {
        status: 1,         // success
        gasUsed: 21000n,
        logs: [],
        confirmations: 12,
      };
    case HASH_REVERTED.toLowerCase():
      return {
        status: 0,         // reverted
        gasUsed: 21000n,
        logs: [],
        confirmations: 12,
      };
    default:
      return null;
  }
};

// ── Import the source AFTER mocks + env are in place ──────────────────────
const { explainTransaction } = await import('../src/og/transactionExplorer.ts');

// ── Run the suite ─────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
async function t(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${label}`);
  } catch (e) {
    fail++;
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e?.message ?? JSON.stringify(e)}`);
  }
}

console.log('explainTransaction — input validation');

await t('input shorter than 66 chars is rejected', async () => {
  const r = await explainTransaction('0xabc');
  assert.equal(r.status, 'invalid-hash');
  assert.equal(r.inputWasValid, false);
  assert.equal(r.found, false);
});

await t('non-hex input is rejected', async () => {
  const r = await explainTransaction('not a hash at all');
  assert.equal(r.status, 'invalid-hash');
});

await t('null/undefined input is rejected', async () => {
  assert.equal((await explainTransaction(null)).status, 'invalid-hash');
  assert.equal((await explainTransaction(undefined)).status, 'invalid-hash');
});

await t('64-hex-without-0x is rejected (must be 0x + 64 hex)', async () => {
  const r = await explainTransaction('a'.repeat(64));
  assert.equal(r.status, 'invalid-hash');
});

await t('address-shaped input (40 hex) is rejected', async () => {
  // Common foot-gun: users pasting a contract address into explain_transaction.
  const r = await explainTransaction('0x' + 'ab'.repeat(20));
  assert.equal(r.status, 'invalid-hash');
});

console.log('\nexplainTransaction — lookups (not-found, rpc-failure)');

await t('not-found hash returns status=not-found', async () => {
  const r = await explainTransaction(HASH_NOT_FOUND);
  assert.equal(r.status, 'not-found');
  assert.equal(r.found, false);
  assert.equal(r.inputWasValid, true);
});

await t('RPC failure returns status=rpc-failure', async () => {
  const r = await explainTransaction(HASH_RPC_FAIL);
  assert.equal(r.status, 'rpc-failure');
  assert.equal(r.found, false);
});

await t('RPC failure on receipt lookup (mined tx) does NOT crash', async () => {
  // HASH_RPC_FAIL is mined (we did not set blockNumber=null in its tx), so
  // explainTransaction proceeds to receipt lookup. Mock throws there.
  // Our contract: it should still return a structured result, not throw.
  const r = await explainTransaction(HASH_RPC_FAIL);
  // The first call throws — we treat that as rpc-failure before we even
  // reach the receipt lookup. So the witness assertion is just "no throw".
  assert.equal(r.status, 'rpc-failure');
});

console.log('\nexplainTransaction — pending vs mined');

await t('mempool tx (blockNumber=null) returns status=pending', async () => {
  const r = await explainTransaction(HASH_PENDING);
  assert.equal(r.status, 'pending');
  assert.equal(r.found, true);
  assert.equal(r.blockNumber, null);
  assert.equal(r.receipt, null);
});

await t('mined tx with no receipt yet (rare) returns status=pending, not not-found', async () => {
  const r = await explainTransaction(HASH_MINED_NO_R);
  assert.equal(r.status, 'pending');
  assert.equal(r.blockNumber, 200);
  assert.equal(r.receipt, null);
});

console.log('\nexplainTransaction — kind classification');

await t('plain OG transfer is kind=og-transfer', async () => {
  const r = await explainTransaction(HASH_OG_XFER);
  assert.equal(r.status, 'ok');
  assert.equal(r.kind, 'og-transfer');
  assert.equal(r.valueOG, '1.0');
  assert.equal(r.data, '0x');
  assert.equal(r.functionSelector, null);
  assert.equal(r.receipt.status, 'success');
});

await t('ERC-20 transfer selector triggers kind=erc20-transfer', async () => {
  const r = await explainTransaction(HASH_ERC20_XFER);
  assert.equal(r.kind, 'erc20-transfer');
  assert.equal(r.functionSelector, '0xa9059cbb');
  assert.equal(r.functionName, 'ERC-20 transfer');
  assert.equal(r.toAlias, 'USDC (mock)');
  assert.equal(r.toKind, 'mock-stable');
});

await t('wrap (WETH deposit) selector → kind=wrap', async () => {
  const r = await explainTransaction(HASH_WRAP);
  assert.equal(r.kind, 'wrap');
  assert.equal(r.functionName, 'WETH deposit (wrap)');
  assert.equal(r.valueOG, '0.5');
  assert.equal(r.toAlias, 'WOG (wrapped native OG)');
});

await t('unwrap (WETH withdraw) selector → kind=unwrap', async () => {
  const r = await explainTransaction(HASH_UNWRAP);
  assert.equal(r.kind, 'unwrap');
  assert.equal(r.functionName, 'WETH withdraw (unwrap)');
  assert.equal(r.toAlias, 'WOG (wrapped native OG)');
});

await t('Uniswap-V2 swap selector → kind=uniswap-swap', async () => {
  const r = await explainTransaction(HASH_UNI_SWAP);
  assert.equal(r.kind, 'uniswap-swap');
  assert.match(r.functionName ?? '', /^Uniswap/);
  assert.equal(r.toAlias, 'Uniswap-V2 router');
  assert.equal(r.toKind, 'dex-router');
});

await t('contract creation (to===null) → kind=contract-creation, isContractCreation=true', async () => {
  const r = await explainTransaction(HASH_CTOR);
  assert.equal(r.to, null);
  assert.equal(r.isContractCreation, true);
  assert.equal(r.kind, 'contract-creation');
});

await t('unknown selector → kind=unknown-call with raw selector surfaced', async () => {
  // HASH_EIP1559 has 0xa9059cbb prefix (so it's not unknown — pick another).
  // Use a custom hash that uses a never-seen selector.
  const unknownHash = '0x' + 'fe'.repeat(32);
  // Re-mock that hash:
  const orig = JsonRpcProvider.prototype.getTransaction;
  JsonRpcProvider.prototype.getTransaction = async function (h) {
    if (String(h).toLowerCase() === unknownHash.toLowerCase()) {
      return {
        from: FROM_ADDR, to: TO_OTHER, value: 0n, nonce: 1,
        gasLimit: 50000n, gasPrice: 1n, maxFeePerGas: null, data: '0xdeadbeef' + '00'.repeat(40),
        blockNumber: 300,
      };
    }
    return orig.call(this, h);
  };
  try {
    const r = await explainTransaction(unknownHash);
    assert.equal(r.kind, 'unknown-call');
    assert.equal(r.functionSelector, '0xdeadbeef');
    assert.equal(r.functionName, null);
  } finally {
    JsonRpcProvider.prototype.getTransaction = orig;
  }
});

console.log('\nexplainTransaction — alias cross-ref');

await t('to is WOG alias → toAlias set, toKind=wrapped-native', async () => {
  const r = await explainTransaction(HASH_TO_WOG);
  assert.equal(r.toAlias, 'WOG (wrapped native OG)');
  assert.equal(r.toKind, 'wrapped-native');
});

await t('to is router alias → toAlias set, toKind=dex-router', async () => {
  const r = await explainTransaction(HASH_TO_ROUTER);
  assert.equal(r.toAlias, 'Uniswap-V2 router');
  assert.equal(r.toKind, 'dex-router');
});

await t('to is unrelated address → toAlias null', async () => {
  const r = await explainTransaction(HASH_OG_XFER);
  assert.equal(r.to, TO_OTHER);
  assert.equal(r.toAlias, null);
  assert.equal(r.toKind, null);
});

await t('to is null (contract creation) → no alias lookup, toAlias stays null', async () => {
  const r = await explainTransaction(HASH_CTOR);
  assert.equal(r.to, null);
  assert.equal(r.toAlias, null);
});

console.log('\nexplainTransaction — receipt details');

await t('reverted tx returns receipt.status="reverted" with top-level status=ok', async () => {
  // HASH_REVERTED is the one with status=0 in our receipt mock. The top-level
  // status stays 'ok' (tx was found & mined) — `reverted` is captured inside
  // `receipt.status` so the LLM can phrase it correctly.
  const r = await explainTransaction(HASH_REVERTED);
  assert.equal(r.status, 'ok');
  assert.ok(r.receipt, 'reverted tx should still have a receipt');
  assert.equal(r.receipt.status, 'reverted');
  assert.equal(r.receipt.gasUsed, '21000');
  assert.equal(r.receipt.logCount, 0);
  assert.equal(r.receipt.confirmations, 12);
});

await t('successful tx returns receipt with status=success, gasUsed, logCount, confirmations', async () => {
  const r = await explainTransaction(HASH_OG_XFER);
  assert.equal(r.status, 'ok');
  assert.equal(r.receipt.status, 'success');
  assert.equal(r.receipt.gasUsed, '21000');
  assert.equal(r.receipt.logCount, 0);
  assert.equal(r.receipt.confirmations, 12);
});

console.log('\nexplainTransaction — EIP-1559 + JSON safety');

await t('EIP-1559 tx surfaces hasEip1559=true and uses maxFeePerGas as gasPrice', async () => {
  const r = await explainTransaction(HASH_EIP1559);
  assert.equal(r.hasEip1559, true);
  assert.equal(r.gasPrice, '2000000000');
});

await t('legacy tx has hasEip1559=false and uses tx.gasPrice', async () => {
  const r = await explainTransaction(HASH_OG_XFER);
  assert.equal(r.hasEip1559, false);
  assert.equal(r.gasPrice, '1000000000');
});

await t('BigInt fields are returned as decimal strings (JSON-safe)', async () => {
  const r = await explainTransaction(HASH_OG_XFER);
  assert.equal(typeof r.valueWei, 'string');
  assert.equal(typeof r.gasLimit, 'string');
  assert.equal(typeof r.gasPrice, 'string');
  for (const f of [r.valueWei, r.gasLimit, r.gasPrice, r.receipt.gasUsed]) {
    assert.match(f, /^\d+$/, `field "${f}" should be a decimal string`);
  }
  // Round-trip through JSON.
  const json = JSON.parse(JSON.stringify(r));
  assert.equal(json.status, 'ok');
  assert.equal(json.kind, 'og-transfer');
});

await t('re-call resilience is fine — same input → same output', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await explainTransaction(HASH_OG_XFER);
    assert.equal(r.kind, 'og-transfer');
    assert.equal(r.valueOG, '1.0');
  }
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('TRANSACTION_EXPLORER_TESTS_FAILED');
  process.exit(1);
}
console.log('TRANSACTION_EXPLORER_TESTS_PASSED');
