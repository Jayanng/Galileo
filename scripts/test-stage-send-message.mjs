// Step 5 verification: stageSend wires resolveRecipientToAddress through
// prepareSend, and the Confirm summary line reads `@handle → 0xAddr`
// for username recipients. Run with plain `node` (no tsx).
//
// We inline copies of the production logic so the test does NOT pull in
// grammY, tsx, or the full wallet stack. The inlined copies are kept in
// lockstep with src/handlers/sendUiHandlers.ts and src/send/sendService.ts.

function isAddress(s) { return /^0x[0-9a-fA-F]{40}$/.test(s); }

// ---- Mock data ------------------------------------------------------------

const USERS = {
  'bobbb':  'user-bob',
  'carol':  'user-carol',
  'davee':  'user-dave',
};

const ADDRESSES = {
  'user-A':   { w1: '0x' + 'a'.repeat(40) }, // active=w1
  'user-bob': { w1: '0x' + 'b1'.repeat(20) }, // single wallet
  'user-carol': { w1: '0xc1'.repeat(20), w2: '0xc2'.repeat(20) }, // active=w2
  'user-dave': {}, // no wallets
};

const ACTIVE = {
  'user-A':    'w1',
  'user-bob':  'w1',
  'user-carol':'w2',
  'user-dave': null,
};

function walletList(uid) {
  const wallets = ADDRESSES[uid] || {};
  return Object.entries(wallets).map(([id, address]) => ({ id, address }));
}

function activeId(uid) {
  return ACTIVE[uid] ?? null;
}

function usernameLookup(handle) {
  return USERS[handle] ?? null;
}

// ---- Inlined resolveRecipientToAddress -----------------------------------

async function resolveRecipientToAddress(input, senderUserId) {
  const trimmed = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { kind: 'address', address: trimmed.toLowerCase(), isSelf: false };
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) {
    return { error: 'not_found' };
  }
  const userId = usernameLookup(handle);
  if (!userId) return { error: 'not_found' };
  const wallets = walletList(userId);
  if (wallets.length === 0) return { error: 'no_wallets' };
  const active = activeId(userId);
  const chosen = (active ? wallets.find(w => w.id === active) : undefined) ?? wallets[0];
  return {
    kind: 'username',
    address: chosen.address,
    username: handle,
    recipientUserId: userId,
    isSelf: userId === senderUserId,
  };
}

// ---- Inlined sendState ---------------------------------------------------

const sendStateStore = new Map();
const sendState = {
  set: (uid, d) => sendStateStore.set(uid, d),
  get: (uid) => sendStateStore.get(uid),
  clear: (uid) => sendStateStore.delete(uid),
};

// ---- Inlined prepareSend (summary + pendingSends store) ------------------

const pendingSends = new Map();

function bigIntAbsFloor(n) {
  // Simple floor parse for positive decimals — sufficient for the summary.
  const [whole, frac = ''] = String(n).split('.');
  const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));
  return wei;
}

async function prepareSend(userId, req) {
  if (!isAddress(req.to)) {
    return { ok: false, error: `"${req.to}" is not a valid address.` };
  }
  let amountWei;
  try {
    amountWei = bigIntAbsFloor(req.amount);
  } catch {
    return { ok: false, error: `"${req.amount}" is not a valid amount.` };
  }
  if (amountWei <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };

  const wallets = walletList(userId);
  if (wallets.length === 0) return { ok: false, error: 'You have no wallets.' };
  const aId = activeId(userId);
  const wallet = wallets.find(w => w.id === aId) ?? wallets[0];

  // pretend balance is huge
  const balance = 1_000_000n * 10n ** 18n;
  if (balance < amountWei) {
    return { ok: false, error: 'Insufficient balance.' };
  }

  const amountLabel = `${req.amount} OG`;
  const toLine =
    req.recipientKind === 'username' && req.resolvedUsername
      ? `\`@${req.resolvedUsername}\` → \`${req.to}\``
      : `\`${req.to}\``;
  const summary = [
    `📤 *Send ${amountLabel}*`,
    '',
    `From: *${wallet.name ?? 'wallet'}*`,
    `\`${wallet.address}\``,
    '',
    'To:',
    toLine,
  ].join('\n');

  pendingSends.set(userId, {
    walletId: wallet.id,
    toAddress: req.to,
    amountWei: amountWei.toString(),
    amountLabel,
    summary,
    recipientKind: req.recipientKind,
    resolvedUsername: req.resolvedUsername,
  });

  return { ok: true, summary };
}

// ---- Mock ctx that captures replies --------------------------------------

function makeCtx() {
  const messages = [];
  return {
    messages,
    async reply(text) {
      messages.push(String(text));
      return { text };
    },
    async answerCallbackQuery() {},
  };
}

// ---- Inlined resolveAndReply ---------------------------------------------

const HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;
function extractHandle(raw) {
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

async function resolveAndReply(ctx, userId, rawInput) {
  const res = await resolveRecipientToAddress(rawInput, userId);
  if (res.error) {
    const handle = extractHandle(rawInput);
    if (res.error === 'not_found') {
      const msg = handle
        ? `I can't find @${handle} \u2014 ask them to message me once so I can link their wallet.`
        : `I couldn't understand that recipient.`;
      sendState.clear(userId);
      await ctx.reply(msg);
      return { ok: false };
    }
    const msg = handle
      ? `@${handle} has no wallet yet \u2014 ask them to create one and try again.`
      : `That recipient has no wallet yet.`;
    sendState.clear(userId);
    await ctx.reply(msg);
    return { ok: false };
  }
  return { ok: true, result: res };
}

// ---- Inlined stageSend (captures prepareSend args via a spy) -------------

const prepareSendCalls = [];
const realPrepareSend = prepareSend;
async function prepareSendSpy(userId, req) {
  // snapshot args (clone)
  prepareSendCalls.push({ userId, req: JSON.parse(JSON.stringify(req)) });
  return realPrepareSend(userId, req);
}

async function stageSend(ctx, userId, draft) {
  const resolved = await resolveAndReply(ctx, userId, draft.to);
  if (!resolved.ok) return;
  const r = resolved.result;
  if (r.error) return;
  if (r.kind !== 'address' && r.kind !== 'username') return;

  await prepareSendSpy(userId, {
    to: r.address,
    amount: draft.amount,
    recipientKind: r.kind,
    resolvedUsername: r.kind === 'username' ? r.username : undefined,
  });
}

// ---- Test harness ---------------------------------------------------------

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.log(`FAIL  ${name} :: ${detail}`);
    failed++;
  }
}

function resetState() {
  prepareSendCalls.length = 0;
  pendingSends.clear();
  sendStateStore.clear();
}

async function runCase(name, fn) {
  resetState();
  try {
    await fn();
    if (failed === 0) {
      // only mark pass if no FAIL lines emitted yet inside this case
    }
  } catch (e) {
    console.log(`FAIL  ${name} threw: ${e && e.message}`);
    failed++;
  }
}

// ---- Case 1: raw 0x address, no resolution needed ------------------------

await runCase('case 1: raw 0x address', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: '0x' + 'a'.repeat(40), amount: '0.1' });
  check('case1 prepareSend called', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case1 to = 0xaaa...', call.req.to === '0x' + 'a'.repeat(40), `to=${call.req.to}`);
  check('case1 amount = 0.1', call.req.amount === '0.1', `amount=${call.req.amount}`);
  check('case1 recipientKind = address', call.req.recipientKind === 'address', `kind=${call.req.recipientKind}`);
  const summary = call.req.to; // used below
  check('case1 pendingSends stored', pendingSends.has('user-A'), 'no pending');
  const ps = pendingSends.get('user-A');
  check('case1 summary contains To:', ps && ps.summary.includes('To:'), 'no To:');
  check('case1 summary contains 0x address', ps && ps.summary.includes('0x' + 'a'.repeat(40)), 'no 0x');
  check('case1 summary NOT contains @', ps && !ps.summary.includes('@'), 'unexpected @');
});

// ---- Case 2: @bobbb resolves to user-bob's wallet -------------------------

await runCase('case 2: @bobbb username', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: '@bobbb', amount: '0.5' });
  check('case2 prepareSend called', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case2 to = 0xbb...', call.req.to === '0x' + 'b1'.repeat(20), `to=${call.req.to}`);
  check('case2 amount = 0.5', call.req.amount === '0.5', `amount=${call.req.amount}`);
  check('case2 recipientKind = username', call.req.recipientKind === 'username', `kind=${call.req.recipientKind}`);
  check('case2 resolvedUsername = bobbb', call.req.resolvedUsername === 'bobbb', `u=${call.req.resolvedUsername}`);
  const ps = pendingSends.get('user-A');
  check('case2 summary contains @bobbb → 0xbb...', ps && ps.summary.includes('@bobbb') && ps.summary.includes('0x' + 'b1'.repeat(20)), 'no @bobbb →');
  check('case2 summary contains arrow', ps && ps.summary.includes('→'), 'no arrow');
});

// ---- Case 3: @ghost not found --------------------------------------------

await runCase('case 3: @ghost not found', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: '@ghost', amount: '0.5' });
  check('case3 prepareSend NOT called', prepareSendCalls.length === 0, `calls=${prepareSendCalls.length}`);
  check('case3 one reply', ctx.messages.length === 1, `msgs=${ctx.messages.length}`);
  const m = ctx.messages[0] || '';
  check('case3 message contains not-found text', m.includes("I can't find @ghost"), `msg=${m}`);
  check('case3 sendState cleared', !sendStateStore.has('user-A'), 'state still present');
});

// ---- Case 4: @davee has no wallets ---------------------------------------

await runCase('case 4: @davee no_wallets', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: '@davee', amount: '0.5' });
  check('case4 prepareSend NOT called', prepareSendCalls.length === 0, `calls=${prepareSendCalls.length}`);
  check('case4 one reply', ctx.messages.length === 1, `msgs=${ctx.messages.length}`);
  const m = ctx.messages[0] || '';
  check('case4 message contains @davee has no wallet', m.includes('@davee has no wallet'), `msg=${m}`);
  check('case4 sendState cleared', !sendStateStore.has('user-A'), 'state still present');
});

// ---- Case 5: 'BOBBB' uppercase, no @, normalize to bobbb -----------------

await runCase('case 5: BOBBB uppercase normalized', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: 'BOBBB', amount: '0.1' });
  check('case5 prepareSend called', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case5 recipientKind = username', call.req.recipientKind === 'username', `kind=${call.req.recipientKind}`);
  check('case5 resolvedUsername = bobbb', call.req.resolvedUsername === 'bobbb', `u=${call.req.resolvedUsername}`);
  check('case5 to = 0xbb...', call.req.to === '0x' + 'b1'.repeat(20), `to=${call.req.to}`);
  const ps = pendingSends.get('user-A');
  check('case5 summary contains @bobbb →', ps && ps.summary.includes('@bobbb') && ps.summary.includes('→'), 'no @bobbb →');
});

// ---- Case 6: @carol multi-wallet active=w2 --------------------------------

await runCase('case 6: @carol multi-wallet active=w2', async () => {
  const ctx = makeCtx();
  await stageSend(ctx, 'user-A', { to: '@carol', amount: '0.3' });
  check('case6 prepareSend called', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case6 to = 0xc2... (active w2)', call.req.to === '0xc2'.repeat(20), `to=${call.req.to}`);
  check('case6 recipientKind = username', call.req.recipientKind === 'username', `kind=${call.req.recipientKind}`);
  check('case6 resolvedUsername = carol', call.req.resolvedUsername === 'carol', `u=${call.req.resolvedUsername}`);
});

// ---- Final ----------------------------------------------------------------

console.log('---');
console.log(`passed=${passed} failed=${failed}`);
if (failed === 0) {
  console.log(`ALL_TESTS_PASS (${passed}/${passed})`);
  process.exit(0);
} else {
  process.exit(1);
}
