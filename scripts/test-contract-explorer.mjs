#!/usr/bin/env node
/**
 * Tests for src/og/contractExplorer.ts — explainContract().
 *
 * Strategy: prototype-patch ethers' JsonRpcProvider to intercept all RPC
 * traffic BEFORE we dynamic-import the source. This means:
 *   • `provider.getCode(addr)` honors our per-address mock map.
 *   • `provider.send(method, params)` only allows `eth_getCode`; every other
 *     call (eth_call from Contract.name/symbol/decimals) throws. The throw
 *     propagates through tryReadErc20's per-call `.catch(() => null)` so
 *     `erc20` always resolves to null in tests — clean and deterministic.
 *   • The module-level `provider` and the lazy `knownContractLookup()` both
 *     inherit the prototype patches because they were created after patching.
 *
 * Required env (set BEFORE import so config.ts zod-validation succeeds):
 *   TELEGRAM_BOT_TOKEN, OPERATOR_PRIVATE_KEY (64 hex), WALLET_ENCRYPTION_KEY
 *   (≥16 chars), OG_COMPUTE_API_KEY. CI writes a .env with these before
 *   `npm test`, so no extra setup is required locally.
 *
 * Run: npx tsx scripts/test-contract-explorer.mjs
 */
import assert from 'node:assert/strict';

// ── EVM test addresses (deterministic) ───────────────────────────────────
const EOA_ADDR       = '0x' + '1'.repeat(40);
const CONTRACT_ADDR  = '0x' + '2'.repeat(40);
const WOG_ADDR       = '0x' + 'a'.repeat(40);
const USDC_ADDR      = '0x' + 'b'.repeat(40);
const ROUTER_ADDR    = '0x' + 'd'.repeat(40);
const RPC_FAIL_ADDR  = '0x' + 'f'.repeat(40);
const FAKE_BYTECODE  = '0x608060405234801561001057600080fd5b5060117';

// ── Configure the alias table via env BEFORE importing ───────────────────
//
// config.WOG_ADDRESS / USDC_ADDRESS / DEX_ROUTER_ADDRESS are read by the
// alias table lazily on each call, but config itself is loaded exactly once
// at module-load time. Setting these envs before contractExplorer (which
// transitively triggers config.ts) ensures the alias table is populated.
process.env.WOG_ADDRESS = WOG_ADDR;
process.env.USDC_ADDRESS = USDC_ADDR;
process.env.DEX_ROUTER_ADDRESS = ROUTER_ADDR;
// Leave USDT/DEX_FACTORY empty so we can verify "no alias" routes.

// ── Mock the chain ───────────────────────────────────────────────────────
//
// contractExplorer uses provider.getCode (via tryReadErc20 indirectly via
// Contract calls → provider.send). Both prototype methods are patched so we
// control every RPC interaction.

const { JsonRpcProvider } = await import('ethers');

// Highest-level patch: only allow eth_getCode through `send`. Everything
// else (eth_call from Contract.metadata reads, eth_chainId, etc.) throws.
// This forces `tryReadErc20` into its "all reads failed → null" branch
// because c.name()/c.symbol()/c.decimals() each throw via send → the
// per-call `.catch(() => null)` in contractExplorer swallows it.
JsonRpcProvider.prototype.send = async function patchedSend(method, params) {
  if (method === 'eth_getCode') {
    return await this.getCode(params[0]);
  }
  throw new Error(`mock: blocked ${method}`);
};

// provider.getCode controls the EOA-vs-contract fork directly.
//   EOA_ADDR       → '0x'             (no bytecode → EOA)
//   RPC_FAIL_ADDR  → throw            (probe RPC failure)
//   anything else  → FAKE_BYTECODE    (pretend it's a contract)
JsonRpcProvider.prototype.getCode = async function patchedGetCode(address) {
  const a = String(address).toLowerCase();
  if (a === RPC_FAIL_ADDR.toLowerCase()) throw new Error('mock: rpc failure');
  if (a === EOA_ADDR.toLowerCase()) return '0x';
  return FAKE_BYTECODE;
};

// ── Import the source AFTER mocks + env are in place ─────────────────────
const { explainContract } = await import('../src/og/contractExplorer.ts');

// ── Run the suite ────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
async function t(label, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✅ ${label}`);
  } catch (e) {
    fail++;
    console.error(`  ❌ ${label}`);
    console.error(`     ${e?.message ?? JSON.stringify(e)}`);
  }
}

console.log('explainContract — status branches');

await t('invalid address returns status=invalid-address', async () => {
  const r = await explainContract('not an address at all');
  assert.equal(r.status, 'invalid-address');
  assert.equal(r.inputWasValid, false);
  assert.equal(r.isContract, false);
  assert.equal(r.knownAlias, null);
  assert.equal(r.knownKind, null);
  assert.equal(r.notes, null);
  assert.equal(r.erc20, null);
});

await t('empty string is rejected', async () => {
  const r = await explainContract('');
  assert.equal(r.status, 'invalid-address');
});

await t('whitespace only is rejected', async () => {
  const r = await explainContract('   ');
  assert.equal(r.status, 'invalid-address');
});

await t('null/undefined input is rejected', async () => {
  const r1 = await explainContract(null);
  const r2 = await explainContract(undefined);
  assert.equal(r1.status, 'invalid-address');
  assert.equal(r2.status, 'invalid-address');
});

console.log('\nexplainContract — EOA / unknown contract branches');

await t('EOA returns isContract=false, erc20=null', async () => {
  const r = await explainContract(EOA_ADDR);
  assert.equal(r.status, 'ok');
  assert.equal(r.isContract, false);
  assert.equal(r.inputWasValid, true);
  assert.equal(r.erc20, null);
  assert.equal(r.knownAlias, null);
  assert.equal(r.knownKind, null);
  assert.equal(r.notes, null);
  // EOA is NOT considered "unknown-contract" — that's reserved for actual
  // contracts that aren't in our alias list.
  assert.notEqual(r.knownKind, 'unknown-contract');
});

await t('unknown contract returns isContract=true and knownKind=unknown-contract', async () => {
  const r = await explainContract(CONTRACT_ADDR);
  assert.equal(r.status, 'ok');
  assert.equal(r.isContract, true);
  assert.equal(r.knownAlias, null);
  assert.equal(r.knownKind, 'unknown-contract');
  assert.equal(r.notes, null);
  // erc20 reads all fail in our mock → null
  assert.equal(r.erc20, null);
});

console.log('\nexplainContract — known alias branches');

await t('WOG alias matches: wrapped-native', async () => {
  const r = await explainContract(WOG_ADDR);
  assert.equal(r.status, 'ok');
  assert.equal(r.isContract, true);
  assert.equal(r.knownAlias, 'WOG (wrapped native OG)');
  assert.equal(r.knownKind, 'wrapped-native');
  assert.match(r.notes ?? '', /WETH9|wrap/i);
  assert.equal(r.erc20, null);
});

await t('USDC alias matches: mock-stable', async () => {
  const r = await explainContract(USDC_ADDR);
  assert.equal(r.status, 'ok');
  assert.equal(r.knownAlias, 'USDC (mock)');
  assert.equal(r.knownKind, 'mock-stable');
  assert.equal(r.isContract, true);
});

await t('router alias matches: dex-router', async () => {
  const r = await explainContract(ROUTER_ADDR);
  assert.equal(r.status, 'ok');
  assert.equal(r.knownAlias, 'Uniswap-V2 router');
  assert.equal(r.knownKind, 'dex-router');
});

await t('USDT/DEX_FACTORY empty → unknown contract', async () => {
  // We did NOT set USDT_ADDRESS or DEX_FACTORY_ADDRESS in env, so these
  // addresses should be treated as unknown contracts.
  const usdtLike = '0x' + 'c'.repeat(40);
  const factoryLike = '0x' + 'e'.repeat(40);
  for (const addr of [usdtLike, factoryLike]) {
    const r = await explainContract(addr);
    assert.equal(r.isContract, true);
    assert.equal(r.knownAlias, null);
    assert.equal(r.knownKind, 'unknown-contract');
  }
});

console.log('\nexplainContract — RPC failure branch');

await t('RPC failure returns isContract=null and status=rpc-failure, but preserves known alias', async () => {
  // Throw in our patched getCode → hasCode returns null → rpc-failure path.
  const r = await explainContract(RPC_FAIL_ADDR);
  assert.equal(r.status, 'rpc-failure');
  assert.equal(r.isContract, null);
  assert.equal(r.inputWasValid, true);
  assert.equal(r.erc20, null);
  // No alias for this address, so knownAlias stays null. We check that the
  // path HANDLES the case though, by also asserting the rpc-failure path
  // for an address that IS in the alias table:
  // (We don't have an alias match for RPC_FAIL_ADDR, so just confirm
  //  fields are present and correct — separate test for aliased+failed.)
});

await t('RPC failure on an address that IS in our alias table still reports the alias', async () => {
  // Temporarily override the instance-level getCode so this single call
  // throws — exercises the "still return what we know" path. Restore by
  // DELETING the own property so the prototype-inherited patched method
  // re-shines through (no bound-wrapper leak into instance state).
  const realProvider = (await import('../src/og/chain.ts')).provider;
  realProvider.getCode = async () => {
    throw new Error('mock: late rpc failure');
  };
  try {
    const r = await explainContract(WOG_ADDR);
    assert.equal(r.status, 'rpc-failure');
    assert.equal(r.isContract, null);
    // Alias info must still be surfaced — the whole point of "still return
    // what we know" in the docstring.
    assert.equal(r.knownAlias, 'WOG (wrapped native OG)');
    assert.equal(r.knownKind, 'wrapped-native');
    assert.match(r.notes ?? '', /WETH9|wrap/i);
  } finally {
    delete realProvider.getCode; // restore prototype-chain lookup
  }
});

console.log('\nexplainContract — case insensitivity');

await t('checksummed address still matches lowercase alias key', async () => {
  // Build a checksummed form using ethers (exported from the same already-imported module).
  const ethersModule = await import('ethers');
  const checksummed = ethersModule.getAddress(WOG_ADDR);
  // Sanity: the checksummed form should differ from the lowercase form.
  assert.notEqual(checksummed, WOG_ADDR);
  const r = await explainContract(checksummed);
  assert.equal(r.knownAlias, 'WOG (wrapped native OG)');
  assert.equal(r.knownKind, 'wrapped-native');
});

await t('mixed-case input from USDC alias', async () => {
  const ethersModule = await import('ethers');
  const checksummed = ethersModule.getAddress(USDC_ADDR);
  const r = await explainContract(checksummed);
  assert.equal(r.knownAlias, 'USDC (mock)');
});

console.log('\nexplainContract — JSON-safety / re-call resilience');

await t('re-invocation is idempotent (alias table is per-call)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await explainContract(WOG_ADDR);
    assert.equal(r.knownAlias, 'WOG (wrapped native OG)');
    assert.equal(r.knownKind, 'wrapped-native');
  }
});

await t('return shape is JSON-serializable (no BigInt, no functions)', async () => {
  const r = await explainContract(WOG_ADDR);
  const json = JSON.stringify(r);
  assert.ok(json.length > 0, 'serializes to non-empty string');
  const parsed = JSON.parse(json);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.address, WOG_ADDR);
  assert.equal(parsed.knownKind, 'wrapped-native');
});

console.log('\nexplainContract — ContractKind union surface');

await t('ContractKind variants are all reachable from the API', async () => {
  const seen = new Set();
  // 'wrapped-native'
  seen.add((await explainContract(WOG_ADDR)).knownKind);
  // 'mock-stable'
  seen.add((await explainContract(USDC_ADDR)).knownKind);
  // 'dex-router'
  seen.add((await explainContract(ROUTER_ADDR)).knownKind);
  // 'unknown-contract'
  seen.add((await explainContract(CONTRACT_ADDR)).knownKind);
  // 'dex-factory' and non-aliased nulls come from RPC-failure / EOA paths
  // which use null (not 'unknown-contract').
  assert.ok(seen.has('wrapped-native'),  'wrapped-native reachable');
  assert.ok(seen.has('mock-stable'),    'mock-stable reachable');
  assert.ok(seen.has('dex-router'),     'dex-router reachable');
  assert.ok(seen.has('unknown-contract'), 'unknown-contract reachable');
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('CONTRACT_EXPLORER_TESTS_FAILED');
  process.exit(1);
}
console.log('CONTRACT_EXPLORER_TESTS_PASSED');
