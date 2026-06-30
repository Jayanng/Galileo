import assert from 'node:assert/strict';
import { resolveRecipientToAddress, type ResolverDeps } from './recipientResolver';

function eq(a: unknown, b: unknown, msg: string): void {
  assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
}

const ADDR_A = '0x' + 'a'.repeat(40);
const ADDR_AA = '0x' + 'aa'.repeat(20);
const ADDR_BB = '0x' + 'bb'.repeat(20);

// Build a deps object with Map-backed mocks (no walletStore / activeWallet).
const userMap = new Map<string, string>([
  ['alice', 'u-1'],
  ['bob', 'u-2'],
  ['davee', 'u-3'],
  // 'ghost' intentionally absent -> not_found
]);
const walletsMap = new Map<string, Array<{ id: string; address: string }>>([
  ['u-1', [{ id: 'w1', address: ADDR_AA }]],
  [
    'u-2',
    [
      { id: 'w1', address: ADDR_AA },
      { id: 'w2', address: ADDR_BB },
    ],
  ],
  ['u-3', []],
]);
const activeMap = new Map<string, string>([['u-2', 'w2']]);

const deps: ResolverDeps = {
  usernameLookup: (u) => userMap.get(u.toLowerCase().replace(/^@/, '')) ?? null,
  listWallets: async (uid) => walletsMap.get(uid) ?? [],
  getActiveId: async (uid) => activeMap.get(uid) ?? null,
};

// --- raw 0x address ---
eq(
  await resolveRecipientToAddress(ADDR_A, 'sender-1', deps),
  { kind: 'address', address: ADDR_A, isSelf: false },
  'raw 0x address branch',
);

// --- mixed-case hex is lowercased in result ---
const MIXED = '0xAbC' + '0'.repeat(37);
const LOWER = '0xabc' + '0'.repeat(37);
eq(
  await resolveRecipientToAddress(MIXED, 'sender-1', deps),
  { kind: 'address', address: LOWER, isSelf: false },
  'mixed-case hex is lowercased',
);

// --- @alice single wallet, no active id -> fallback to wallets[0] ---
eq(
  await resolveRecipientToAddress('@alice', 'sender-1', deps),
  {
    kind: 'username',
    address: ADDR_AA,
    username: 'alice',
    recipientUserId: 'u-1',
    isSelf: false,
  },
  '@alice -> single-wallet fallback',
);

// --- @bob multi wallet, active=w2 ---
eq(
  await resolveRecipientToAddress('@bob', 'sender-1', deps),
  {
    kind: 'username',
    address: ADDR_BB,
    username: 'bob',
    recipientUserId: 'u-2',
    isSelf: false,
  },
  '@bob -> active wallet w2 is picked',
);

// --- isSelf ---
eq(
  await resolveRecipientToAddress('@bob', 'u-2', deps),
  {
    kind: 'username',
    address: ADDR_BB,
    username: 'bob',
    recipientUserId: 'u-2',
    isSelf: true,
  },
  'isSelf=true when senderUserId equals recipientUserId',
);

// --- not_found (unknown handle) ---
eq(
  await resolveRecipientToAddress('@ghost', 'sender-1', deps),
  { error: 'not_found' },
  'unknown handle -> not_found',
);

// --- no_wallets ---
eq(
  await resolveRecipientToAddress('@davee', 'sender-1', deps),
  { error: 'no_wallets' },
  '@davee has no wallets -> no_wallets',
);

// --- garbage input (not address, not handle) ---
eq(
  await resolveRecipientToAddress('!!!', 'sender-1', deps),
  { error: 'not_found' },
  'garbage input -> not_found',
);

// --- handle too short ---
eq(
  await resolveRecipientToAddress('@ab', 'sender-1', deps),
  { error: 'not_found' },
  'handle too short -> not_found',
);

// --- leading @ is optional ---
eq(
  await resolveRecipientToAddress('alice', 'sender-1', deps),
  {
    kind: 'username',
    address: ADDR_AA,
    username: 'alice',
    recipientUserId: 'u-1',
    isSelf: false,
  },
  'leading @ is optional on input',
);

console.log('recipientResolver: address, username, not_found, no_wallets, isSelf branches passed ✓');
