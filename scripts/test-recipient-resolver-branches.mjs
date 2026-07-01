#!/usr/bin/env node
// Standalone test for resolveRecipientToAddress (branches set). Mirrors
// src/wallet/recipientResolver.test.ts but uses plain node (no tsx, no
// ethers, no walletStore). The resolver is re-implemented inline so this
// file runs in WSL2 without the TS toolchain.

const ADDR_A = '0x' + 'a'.repeat(40);
const ADDR_AA = '0x' + 'aa'.repeat(20);
const ADDR_BB = '0x' + 'bb'.repeat(20);

const userMap = new Map([
  ['alice', 'u-1'],
  ['bobby', 'u-2'],
  ['davee', 'u-3'],
]);
const walletsMap = new Map([
  ['u-1', [{ id: 'w1', address: ADDR_AA }]],
  ['u-2', [
    { id: 'w1', address: ADDR_AA },
    { id: 'w2', address: ADDR_BB },
  ]],
  ['u-3', []],
]);
const activeMap = new Map([['u-2', 'w2']]);

const deps = {
  usernameLookup: (u) => userMap.get(String(u).toLowerCase().replace(/^@/, '')) ?? null,
  listWallets: async (uid) => walletsMap.get(uid) ?? [],
  getActiveId: async (uid) => activeMap.get(uid) ?? null,
};

async function resolveRecipientToAddress(input, senderUserId, d = deps) {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { kind: 'address', address: trimmed.toLowerCase(), isSelf: false };
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) return { error: 'not_found' };
  const userId = d.usernameLookup(handle);
  if (!userId) return { error: 'not_found' };
  const wallets = await d.listWallets(userId);
  if (wallets.length === 0) return { error: 'no_wallets' };
  const activeId = await d.getActiveId(userId);
  const active = activeId ? wallets.find((w) => w.id === activeId) : undefined;
  const chosen = active ?? wallets[0];
  return {
    kind: 'username',
    address: chosen.address,
    username: handle,
    recipientUserId: userId,
    isSelf: userId === senderUserId,
  };
}

let pass = 0;
let fail = 0;

function deepEq(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  if (ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => deepEq(a[k], b[k]));
}

async function assertEq(promiseOrValue, expected, name) {
  const actual = await promiseOrValue;
  const ok = deepEq(actual, expected);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`);
  }
}

await assertEq(
  resolveRecipientToAddress(ADDR_A, 'sender-1'),
  { kind: 'address', address: ADDR_A, isSelf: false },
  'raw 0x address branch',
);

const MIXED = '0xAbC' + '0'.repeat(37);
const LOWER = '0xabc' + '0'.repeat(37);
await assertEq(
  resolveRecipientToAddress(MIXED, 'sender-1'),
  { kind: 'address', address: LOWER, isSelf: false },
  'mixed-case hex is lowercased',
);

await assertEq(
  resolveRecipientToAddress('@alice', 'sender-1'),
  { kind: 'username', address: ADDR_AA, username: 'alice', recipientUserId: 'u-1', isSelf: false },
  '@alice -> single-wallet fallback',
);

await assertEq(
  resolveRecipientToAddress('@bobby', 'sender-1'),
  { kind: 'username', address: ADDR_BB, username: 'bobby', recipientUserId: 'u-2', isSelf: false },
  '@bobby -> active wallet w2 is picked',
);

await assertEq(
  resolveRecipientToAddress('@bobby', 'u-2'),
  { kind: 'username', address: ADDR_BB, username: 'bobby', recipientUserId: 'u-2', isSelf: true },
  'isSelf=true when senderUserId equals recipientUserId',
);

await assertEq(
  resolveRecipientToAddress('@ghost', 'sender-1'),
  { error: 'not_found' },
  'unknown handle -> not_found',
);

await assertEq(
  resolveRecipientToAddress('@davee', 'sender-1'),
  { error: 'no_wallets' },
  '@davee has no wallets -> no_wallets',
);

await assertEq(
  resolveRecipientToAddress('!!!', 'sender-1'),
  { error: 'not_found' },
  'garbage input -> not_found',
);

await assertEq(
  resolveRecipientToAddress('@ab', 'sender-1'),
  { error: 'not_found' },
  'handle too short -> not_found',
);

await assertEq(
  resolveRecipientToAddress('alice', 'sender-1'),
  { kind: 'username', address: ADDR_AA, username: 'alice', recipientUserId: 'u-1', isSelf: false },
  'leading @ is optional on input',
);

console.log('---');
console.log(`passed=${pass} failed=${fail}`);
if (fail === 0) console.log(`ALL_TESTS_PASS (${pass}/${pass})`);
process.exit(fail === 0 ? 0 : 1);
