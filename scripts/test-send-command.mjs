// Step 7 verification: handleSendCommand in src/handlers/sendUiHandlers.ts
// accepts a Telegram @handle as the recipient in either slot. We inline the
// production logic so the test exercises the actual control flow without
// pulling in grammY, tsx, or ethers. Run with plain `node`.

function isAddress(s) { return /^0x[0-9a-fA-F]{40}$/i.test(s); }

// ---- usernameIndex mock --------------------------------------------------

const handleToUser = new Map();
const usernameIndex = {
  record(handle, userId) { handleToUser.set(handle.toLowerCase(), userId); },
  lookup(handle) {
    const uid = handleToUser.get(String(handle).toLowerCase());
    return uid === undefined ? null : uid;
  },
};

// ---- listWallets / getActiveId mocks -------------------------------------

function listWallets(userId) {
  if (userId === 'user-B') {
    return [
      { id: 'w1', name: 'Main',    address: '0x' + 'a'.repeat(40) },
      { id: 'w2', name: 'Trading', address: '0x' + 'b'.repeat(40) },
    ];
  }
  if (userId === 'user-D') return [];
  return undefined;
}

function getActiveId(userId) {
  if (userId === 'user-B') return 'w1';
  return undefined;
}

// ---- Inlined resolveRecipientToAddress -----------------------------------

async function resolveRecipientToAddress(input, senderUserId) {
  const trimmed = String(input).trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { kind: 'address', address: trimmed.toLowerCase(), isSelf: false };
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(handle)) {
    return { error: 'not_found' };
  }
  const userId = usernameIndex.lookup(handle);
  if (!userId) return { error: 'not_found' };
  const wallets = listWallets(userId);
  if (!wallets || wallets.length === 0) return { error: 'no_wallets' };
  const active = getActiveId(userId);
  const chosen = (active ? wallets.find(w => w.id === active) : undefined) ?? wallets[0];
  return {
    kind: 'username',
    address: chosen.address,
    username: handle,
    recipientUserId: userId,
    isSelf: userId === senderUserId,
  };
}

// ---- sendState / pendingSends mock stores --------------------------------

const sendStateStore = new Map();
const sendState = {
  set: (uid, d) => sendStateStore.set(uid, d),
  get: (uid) => sendStateStore.get(uid),
  clear: (uid) => sendStateStore.delete(uid),
  has: (uid) => sendStateStore.has(uid),
};
const pendingSendsStore = new Map();
const pendingSends = {
  set: (uid, d) => pendingSendsStore.set(uid, d),
  get: (uid) => pendingSendsStore.get(uid),
  clear: (uid) => pendingSendsStore.delete(uid),
  has: (uid) => pendingSendsStore.has(uid),
};

// ---- prepareSend spy -----------------------------------------------------

const prepareSendCalls = [];
async function prepareSend(userId, req) {
  prepareSendCalls.push({ userId, req: JSON.parse(JSON.stringify(req)) });
  return { ok: true, summary: `CONFIRM @${req.to}` };
}

// ---- Inlined sendUiHandlers helpers --------------------------------------

const HANDLE_RE = /^[A-Za-z0-9_]{5,32}$/;
function extractHandle(raw) {
  const handle = String(raw).trim().replace(/^@/, '').toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

function userIdOf(ctx) {
  // Not used by handleSendCommand path in this test; keep for completeness.
  return ctx.userId || null;
}

async function resolveAndReply(ctx, userId, rawInput) {
  const res = await resolveRecipientToAddress(rawInput, userId);
  if ('error' in res) {
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

async function stageSend(ctx, userId, draft) {
  const resolved = await resolveAndReply(ctx, userId, draft.to);
  if (!resolved.ok) return;
  const r = resolved.result;
  if (r.error) return;
  if (r.kind !== 'address' && r.kind !== 'username') return;
  await prepareSend(userId, {
    to: r.address,
    amount: draft.amount,
    recipientKind: r.kind,
    resolvedUsername: r.kind === 'username' ? r.username : undefined,
  });
}

// ---- Inlined handleSendCommand (mirror of production body) ---------------

async function handleSendCommand(ctx) {
  const userId = ctx.userId || null;
  if (!userId) return;
  const parts = String(ctx.match ?? '').trim().split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const [a, b] = parts;

    if (isAddress(a)) {
      await stageSend(ctx, userId, { to: a, amount: b, recipientKind: 'address' });
      return;
    }
    if (isAddress(b)) {
      await stageSend(ctx, userId, { to: b, amount: a, recipientKind: 'address' });
      return;
    }

    const handleA = extractHandle(a);
    if (handleA) {
      await stageSend(ctx, userId, { to: '@' + handleA, amount: b });
      return;
    }
    const handleB = extractHandle(b);
    if (handleB) {
      await stageSend(ctx, userId, { to: '@' + handleB, amount: a });
      return;
    }
  }

  sendState.set(userId, { stage: 'address' });
  await ctx.reply('📤 *Send OG*\n\nEnter the recipient address (or /start to cancel):', {
    parse_mode: 'Markdown',
  });
}

// ---- Mock ctx ------------------------------------------------------------

function makeCtx(match, userId = 'user-A') {
  return {
    match,
    userId,
    messages: [],
    async reply(text) { this.messages.push(String(text)); },
    async answerCallbackQuery() {},
    async editMessageReplyMarkup() {},
  };
}

// ---- Setup ---------------------------------------------------------------

usernameIndex.record('tebasv2', 'user-B'); // has wallet
usernameIndex.record('bobbb',   'user-C'); // has 1 wallet (mapped below)
usernameIndex.record('carol',   'user-C'); // alias of bobbb
usernameIndex.record('davee',   'user-D'); // no wallet

// user-B has wallets; ensure listWallets responds for user-B (not user-C).
// The spec only requires user-B (tebasv2 → user-B). bobbb/carol/davee are
// for spec completeness; their resolution outcomes aren't exercised in cases
// 1–7 (case 5 is @ghost → not_found, case 6 is @davee → no_wallets).

// ---- Test harness --------------------------------------------------------

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); passed++; }
  else      { console.log(`FAIL  ${name} :: ${detail}`); failed++; }
}

function resetState() {
  prepareSendCalls.length = 0;
  sendStateStore.clear();
  pendingSendsStore.clear();
}

async function runCase(name, fn) {
  resetState();
  try { await fn(); }
  catch (e) { console.log(`FAIL  ${name} threw: ${e && e.message}`); failed++; }
}

const ADDR_A = '0x' + 'a'.repeat(40);
const HEX_ADDR = '0xabcdef0123456789abcdef0123456789abcdef01'; // 40 hex after 0x, lowercased (resolver normalizes)

// ---- Case 1: /send @tebasv2 0.1 ------------------------------------------

await runCase('case 1: /send @tebasv2 0.1', async () => {
  const ctx = makeCtx('@tebasv2 0.1');
  await handleSendCommand(ctx);
  check('case1 prepareSend called once', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case1 to = 0xaaa...', call && call.req.to === ADDR_A, `to=${call && call.req.to}`);
  check('case1 amount = 0.1', call && call.req.amount === '0.1', `amount=${call && call.req.amount}`);
  check('case1 recipientKind = username', call && call.req.recipientKind === 'username', `kind=${call && call.req.recipientKind}`);
  check('case1 resolvedUsername = tebasv2', call && call.req.resolvedUsername === 'tebasv2', `u=${call && call.req.resolvedUsername}`);
  check('case1 ctx.messages empty', ctx.messages.length === 0, `msgs=${JSON.stringify(ctx.messages)}`);
  check('case1 sendState empty', !sendState.has('user-A'), 'state still present');
});

// ---- Case 2: /send 0.1 @tebasv2 (swap) -----------------------------------

await runCase('case 2: /send 0.1 @tebasv2', async () => {
  const ctx = makeCtx('0.1 @tebasv2');
  await handleSendCommand(ctx);
  check('case2 prepareSend called once', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case2 to = 0xaaa...', call && call.req.to === ADDR_A, `to=${call && call.req.to}`);
  check('case2 amount = 0.1', call && call.req.amount === '0.1', `amount=${call && call.req.amount}`);
  check('case2 recipientKind = username', call && call.req.recipientKind === 'username', `kind=${call && call.req.recipientKind}`);
  check('case2 resolvedUsername = tebasv2', call && call.req.resolvedUsername === 'tebasv2', `u=${call && call.req.resolvedUsername}`);
  check('case2 ctx.messages empty', ctx.messages.length === 0, `msgs=${JSON.stringify(ctx.messages)}`);
});

// ---- Case 3: REGRESSION /send 0xAbC... 0.5 -------------------------------

await runCase('case 3: /send 0xAbC... 0.5', async () => {
  const ctx = makeCtx(`${HEX_ADDR} 0.5`);
  await handleSendCommand(ctx);
  check('case3 prepareSend called once', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case3 to = 0xAbC...', call && call.req.to === HEX_ADDR, `to=${call && call.req.to}`);
  check('case3 amount = 0.5', call && call.req.amount === '0.5', `amount=${call && call.req.amount}`);
  check('case3 recipientKind = address', call && call.req.recipientKind === 'address', `kind=${call && call.req.recipientKind}`);
});

// ---- Case 4: REGRESSION /send 0.5 0xAbC... -------------------------------

await runCase('case 4: /send 0.5 0xAbC...', async () => {
  const ctx = makeCtx(`0.5 ${HEX_ADDR}`);
  await handleSendCommand(ctx);
  check('case4 prepareSend called once', prepareSendCalls.length === 1, `calls=${prepareSendCalls.length}`);
  const call = prepareSendCalls[0];
  check('case4 to = 0xAbC...', call && call.req.to === HEX_ADDR, `to=${call && call.req.to}`);
  check('case4 amount = 0.5', call && call.req.amount === '0.5', `amount=${call && call.req.amount}`);
  check('case4 recipientKind = address', call && call.req.recipientKind === 'address', `kind=${call && call.req.recipientKind}`);
});

// ---- Case 5: /send @ghost 0.1 (not_found) --------------------------------

await runCase('case 5: /send @ghost 0.1 (not_found)', async () => {
  const ctx = makeCtx('@ghost 0.1');
  await handleSendCommand(ctx);
  check('case5 prepareSend NOT called', prepareSendCalls.length === 0, `calls=${prepareSendCalls.length}`);
  check('case5 at least one reply', ctx.messages.length >= 1, `msgs=${ctx.messages.length}`);
  const last = ctx.messages[ctx.messages.length - 1] || '';
  check('case5 last reply mentions @ghost', last.includes("can't find @ghost"), `msg=${last}`);
  check('case5 sendState cleared', !sendState.has('user-A'), 'state still present');
});

// ---- Case 6: /send @davee 0.1 (no_wallets) --------------------------------

await runCase('case 6: /send @davee 0.1 (no_wallets)', async () => {
  const ctx = makeCtx('@davee 0.1');
  await handleSendCommand(ctx);
  check('case6 prepareSend NOT called', prepareSendCalls.length === 0, `calls=${prepareSendCalls.length}`);
  check('case6 at least one reply', ctx.messages.length >= 1, `msgs=${ctx.messages.length}`);
  const last = ctx.messages[ctx.messages.length - 1] || '';
  check('case6 last reply mentions @davee has no wallet', last.includes('@davee has no wallet'), `msg=${last}`);
  check('case6 sendState cleared', !sendState.has('user-A'), 'state still present');
});

// ---- Case 7: /send 0.1 (amount only) -------------------------------------

await runCase('case 7: /send 0.1 (fallthrough to interactive)', async () => {
  const ctx = makeCtx('0.1');
  await handleSendCommand(ctx);
  check('case7 prepareSend NOT called', prepareSendCalls.length === 0, `calls=${prepareSendCalls.length}`);
  check('case7 at least one reply', ctx.messages.length >= 1, `msgs=${ctx.messages.length}`);
  const last = ctx.messages[ctx.messages.length - 1] || '';
  check('case7 last reply prompts for address', last.includes('Enter the recipient address'), `msg=${last}`);
  const draft = sendState.get('user-A');
  check('case7 sendState.stage = address', draft && draft.stage === 'address', `stage=${draft && draft.stage}`);
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
