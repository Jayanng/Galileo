// Standalone test for resolveRecipientToAddress. Mocks walletStore and
// activeWallet so no real Telegram/0G calls happen. Run with:
//   node scripts/test-recipient-resolver.mjs
//
// The resolver is re-implemented inline (copied from src) to avoid the TS
// toolchain. If the resolver changes, update here too.

const ADDR_A = '0x' + 'a'.repeat(40);
const ADDR_BOB = '0x' + 'b'.repeat(40);
const ADDR_CAROL1 = '0x' + 'c1'.repeat(20);
const ADDR_CAROL2 = '0x' + 'c2'.repeat(20);

const mockWallets = {
  'user-bob': [{ id: 'w1', address: ADDR_BOB }],
  'user-carol': [
    { id: 'w1', address: ADDR_CAROL1 },
    { id: 'w2', address: ADDR_CAROL2 },
  ],
  'user-dave': [],
  'sender-id': [{ id: 'w1', address: ADDR_BOB }],
};
const mockActive = { 'user-carol': 'w2' };
const mockLookup = {
  bobbb: 'user-bob',
  carol: 'user-carol',
  davee: 'user-dave',
  selfy: 'sender-id',
};

const deps = {
  usernameLookup: (u) => {
    const k = u.toLowerCase().replace(/^@/, '');
    return mockLookup[k] ?? null;
  },
  listWallets: async (uid) => mockWallets[uid] ?? [],
  getActiveId: async (uid) => mockActive[uid] ?? null,
};

// ---- copy of resolver logic (kept in sync) ----
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

const cases = [
  ['raw 0x address', ADDR_A, 'sender-id',
    { kind: 'address', address: ADDR_A, isSelf: false }],
  ['@bobbb (single wallet)', '@bobbb', 'sender-id',
    { kind: 'username', address: ADDR_BOB, username: 'bobbb', recipientUserId: 'user-bob', isSelf: false }],
  ['BOBBB uppercase no @', 'BOBBB', 'sender-id',
    { kind: 'username', address: ADDR_BOB, username: 'bobbb', recipientUserId: 'user-bob', isSelf: false }],
  ['@carol (multi wallet, active=w2)', '@carol', 'sender-id',
    { kind: 'username', address: ADDR_CAROL2, username: 'carol', recipientUserId: 'user-carol', isSelf: false }],
  ['@davee (no wallets)', '@davee', 'sender-id', { error: 'no_wallets' }],
  ['@ghost (unknown)', '@ghost', 'sender-id', { error: 'not_found' }],
  ['@selfy (isSelf=true)', '@selfy', 'sender-id',
    { kind: 'username', address: ADDR_BOB, username: 'selfy', recipientUserId: 'sender-id', isSelf: true }],
];

let pass = 0;
let fail = 0;
for (const [name, input, sender, expected] of cases) {
  const got = await resolveRecipientToAddress(input, sender);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS:', name); }
  else {
    fail++;
    console.error('FAIL:', name);
    console.error('  expected:', JSON.stringify(expected));
    console.error('  got:     ', JSON.stringify(got));
  }
}
if (fail === 0) {
  console.log(`ALL_TESTS_PASS (${pass}/${cases.length})`);
  process.exit(0);
} else {
  console.error(`${fail} tests failed`);
  process.exit(1);
}
