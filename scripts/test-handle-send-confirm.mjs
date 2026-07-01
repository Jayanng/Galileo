// Step 6 verification: handleSendConfirm uses pendingSends.toAddress
// (TOCTOU-safe), defensively guards malformed addresses, and renders
// 'Sent to @handle' header for username recipients.
// Run with plain `node` (no tsx, no ethers).

const EXPLORER_TX = 'https://chainscan-galileo.0g.ai/tx/';

// ---- Mock pendingSends / sendState --------------------------------------

const pendingSends = {
  _m: new Map(),
  set(uid, p) { this._m.set(uid, p); },
  get(uid) { return this._m.get(uid); },
  clear(uid) { if (uid) this._m.delete(uid); else this._m.clear(); },
  has(uid) { return this._m.has(uid); },
};

const sendState = {
  _m: new Map(),
  set(uid, p) { this._m.set(uid, p); },
  get(uid) { return this._m.get(uid); },
  clear(uid) { if (uid) this._m.delete(uid); else this._m.clear(); },
  has(uid) { return this._m.has(uid); },
};

// ---- Mock executeSend ----------------------------------------------------

const executeSendCalls = [];
async function executeSend(userId) {
  executeSendCalls.push({ userId });
  const p = pendingSends.get(userId);
  return { ok: true, hash: '0x' + '1'.repeat(64), summary: p.summary };
}

// ---- Mock ctx ------------------------------------------------------------

function makeCtx() {
  return {
    messages: [],
    async reply(text) { this.messages.push(String(text)); },
    async answerCallbackQuery() {},
    async editMessageReplyMarkup() {},
  };
}

// ---- Inlined handleSendConfirm (mirrors production) ----------------------

async function handleSendConfirm(ctx, userId) {
  await ctx.answerCallbackQuery({ text: 'Submitting…' });
  try { await ctx.editMessageReplyMarkup(); } catch {}

  const p = pendingSends.get(userId);
  if (!p) {
    await ctx.reply('No pending send. Use /send to start a new transfer.');
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/i.test(p.toAddress)) {
    pendingSends.clear(userId);
    sendState.clear(userId);
    await ctx.reply('❌ Send failed: malformed pending recipient.');
    return;
  }
  const res = await executeSend(userId);
  if (!res.ok) {
    await ctx.reply(`❌ Send failed: ${res.error}`);
    return;
  }
  const header = p.recipientKind === 'username' && p.resolvedUsername
    ? `✅ *Sent to @${p.resolvedUsername}*`
    : '✅ *Sent!*';
  await ctx.reply(
    [header, '', res.summary, '', `Tx: [${res.hash.slice(0, 12)}…](${EXPLORER_TX}${res.hash})`].join('\n'),
    { parse_mode: 'Markdown' },
  );
}

// ---- Test harness --------------------------------------------------------

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); passed++; }
  else { console.log(`FAIL  ${name} :: ${detail}`); failed++; }
}
function reset() {
  pendingSends.clear();
  sendState.clear();
  executeSendCalls.length = 0;
}

async function runCase(name, fn) { reset(); try { await fn(); } catch (e) { console.log(`FAIL ${name} threw: ${e.message}`); failed++; } }

// ---- Case 1: username-resolved pending ----------------------------------

await runCase('case 1 username', async () => {
  pendingSends.set('user-A', {
    recipientKind: 'username',
    resolvedUsername: 'tebasv2',
    toAddress: '0x' + 'a'.repeat(40),
    walletId: 'w1', walletName: 'Main',
    amountWei: '100000000000000000', amountLabel: '0.1 OG',
    summary: '📤 *Send 0.1 OG*\n\nFrom: *Main*\n`0xaaa...`\n\nTo:\n`@tebasv2` → `0x' + 'a'.repeat(40) + '`',
  });
  const ctx = makeCtx();
  await handleSendConfirm(ctx, 'user-A');
  check('1 executeSend called', executeSendCalls.length === 1);
  check('1 executeSend for user-A', executeSendCalls[0].userId === 'user-A');
  const reply = ctx.messages[ctx.messages.length - 1] || '';
  check('1 reply has @tebasv2 header', reply.includes('✅ *Sent to @tebasv2*'), reply.slice(0, 80));
  check('1 reply has 0xaaa addr', reply.includes('0x' + 'a'.repeat(40)));
  check('1 reply has Tx link', reply.includes('Tx:') && reply.includes(EXPLORER_TX));
  check('1 one reply message', ctx.messages.length === 1);
});

// ---- Case 2: address-resolved pending -----------------------------------

await runCase('case 2 address', async () => {
  pendingSends.set('user-A', {
    recipientKind: 'address',
    toAddress: '0x' + 'b'.repeat(40),
    walletId: 'w1', walletName: 'Main',
    amountWei: '1', amountLabel: '0.5 OG',
    summary: '📤 *Send 0.5 OG*\n\nFrom: *Main*\n`0xbbb...`\n\nTo:\n`0x' + 'b'.repeat(40) + '`',
  });
  const ctx = makeCtx();
  await handleSendConfirm(ctx, 'user-A');
  check('2 executeSend called', executeSendCalls.length === 1);
  const reply = ctx.messages[ctx.messages.length - 1] || '';
  check('2 reply has Sent! header', reply.includes('✅ *Sent!*'));
  check('2 reply NOT has @tebasv2', !reply.includes('Sent to @'));
  check('2 reply has 0xbbb addr', reply.includes('0x' + 'b'.repeat(40)));
  check('2 reply has Tx link', reply.includes('Tx:') && reply.includes(EXPLORER_TX));
});

// ---- Case 3: no pending -------------------------------------------------

await runCase('case 3 no pending', async () => {
  // pendingSends empty
  const ctx = makeCtx();
  await handleSendConfirm(ctx, 'user-A');
  check('3 executeSend NOT called', executeSendCalls.length === 0);
  const reply = ctx.messages[ctx.messages.length - 1] || '';
  check('3 reply says no pending', reply.includes('No pending send'));
});

// ---- Case 4: malformed toAddress ----------------------------------------

await runCase('case 4 malformed', async () => {
  pendingSends.set('user-A', {
    recipientKind: 'username',
    resolvedUsername: 'tebasv2',
    toAddress: '@tebasv2', // malformed — not 0x
    walletId: 'w1', walletName: 'Main',
    amountWei: '1', amountLabel: '0 OG', summary: 'x',
  });
  const ctx = makeCtx();
  await handleSendConfirm(ctx, 'user-A');
  check('4 executeSend NOT called', executeSendCalls.length === 0);
  check('4 pendingSends cleared', !pendingSends.has('user-A'));
  const reply = ctx.messages[ctx.messages.length - 1] || '';
  check('4 reply says malformed', reply.includes('malformed pending recipient'));
});

// ---- Final ---------------------------------------------------------------

console.log('---');
console.log(`passed=${passed} failed=${failed}`);
if (failed === 0) {
  console.log(`ALL_TESTS_PASS (${passed}/${passed})`);
  process.exit(0);
} else {
  process.exit(1);
}
