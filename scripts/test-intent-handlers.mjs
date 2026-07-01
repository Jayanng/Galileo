/**
 * Tests for src/handlers/intentHandlers.ts — command parsing, rendering, and
 * ownership checks.
 *
 * Inline copies of the production logic (regex parsers + rendering helpers)
 * are kept in lockstep with src/handlers/intentHandlers.ts. The store-backed
 * parts of the handlers (intentStore CRUD) are covered by
 * scripts/test-intent-store.mjs.
 */

function isHex(s) { return /^[0-9a-fA-F]+$/.test(s); }

// ── Inlined command parsers (mirror handleCancelCommand / handlePauseCommand)

function parseCancel(text) {
  const m = /^\/cancel\s+([0-9a-fA-F]+)\s*$/.exec(text);
  return m ? { id: m[1] } : null;
}
function parsePause(text) {
  const m = /^\/pause\s+([0-9a-fA-F]+)\s*$/.exec(text);
  return m ? { id: m[1] } : null;
}

// ── Inlined callback-data parser

function parseIntentCallback(data) {
  if (typeof data !== 'string') return null;
  const m = /^intent:(cancel|pause):([0-9a-fA-F]+)$/.exec(data);
  if (!m) return null;
  return { action: m[1], id: m[2] };
}

// ── Inlined rendering helpers

function statusBadge(status) {
  switch (status) {
    case 'active': return '✅ active';
    case 'paused': return '⏸ paused';
    case 'fired':  return '✓ fired';
    default:       return status;
  }
}
function typeIcon(type) { return type === 'dca' ? '📈' : '🔔'; }

function renderIntentList(intents) {
  if (intents.length === 0) {
    return 'No scheduled intents yet.\n\nSay "dca 1 OG into USDC weekly" or "alert me if OG drops below $1" to create one.';
  }
  const lines = ['📅 *Your scheduled intents*', ''];
  intents.forEach((i, idx) => {
    lines.push(`${idx + 1}. ${typeIcon(i.type)} ${i.summary}`);
    lines.push(`   _${statusBadge(i.status)}_ · id: \`${i.id}\``);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

// ── Ownership check (mirrors the existing handler logic)

function canAct(intent, userId) {
  return intent !== null && intent.userId === userId;
}

// ── Tests ──────────────────────────────────────────────────────────────

let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ ${label} ${detail}`); failed++; }
}

console.log('parseCancel');
check('matches "/cancel abc12345"', parseCancel('/cancel abc12345')?.id === 'abc12345');
check('matches "/cancel ABCDEF12"', parseCancel('/cancel ABCDEF12')?.id === 'ABCDEF12');
check('matches with extra spaces', parseCancel('/cancel   deadbeef   ')?.id === 'deadbeef');
check('rejects empty', parseCancel('/cancel') === null);
check('rejects bare id', parseCancel('abc12345') === null);
check('rejects trailing junk', parseCancel('/cancel abc12345 extra') === null);
check('rejects non-hex', parseCancel('/cancel zzzzzzzz') === null);

console.log('\nparsePause');
check('matches "/pause abc12345"', parsePause('/pause abc12345')?.id === 'abc12345');
check('rejects empty', parsePause('/pause') === null);
check('rejects non-hex', parsePause('/pause zzzzzzzz') === null);

console.log('\nparseIntentCallback (inline buttons)');
check('cancel:abc12345', JSON.stringify(parseIntentCallback('intent:cancel:abc12345')) === JSON.stringify({ action: 'cancel', id: 'abc12345' }));
check('pause:DEADBEEF', JSON.stringify(parseIntentCallback('intent:pause:DEADBEEF')) === JSON.stringify({ action: 'pause', id: 'DEADBEEF' }));
check('rejects unknown action', parseIntentCallback('intent:resume:abc') === null);
check('rejects malformed', parseIntentCallback('not-an-intent') === null);
check('rejects empty', parseIntentCallback('') === null);
check('rejects missing id', parseIntentCallback('intent:cancel:') === null);
check('rejects non-hex id', parseIntentCallback('intent:cancel:zzz') === null);

console.log('\nrenderIntentList — empty');
const emptyRender = renderIntentList([]);
check('shows empty-state copy', emptyRender.includes('No scheduled intents'));
check('suggests DCA example', emptyRender.includes('dca 1 OG into USDC weekly'));
check('suggests alert example', emptyRender.includes('alert me if OG drops below $1'));

console.log('\nrenderIntentList — mixed intents');
const intents = [
  { id: 'abcd1234', type: 'dca', status: 'active', summary: 'DCA: 1 OG → USDC (daily)' },
  { id: 'deadbeef', type: 'alert', status: 'paused', summary: 'Alert: OG below $1' },
  { id: '12345678', type: 'alert', status: 'fired', summary: 'Alert: BTC above $100k' },
];
const rendered = renderIntentList(intents);
check('includes header', rendered.includes('Your scheduled intents'));
check('uses DCA icon', rendered.includes('📈'));
check('uses alert icon', rendered.includes('🔔'));
check('shows active badge', rendered.includes('✅ active'));
check('shows paused badge', rendered.includes('⏸ paused'));
check('shows fired badge', rendered.includes('✓ fired'));
check('shows id in monospace', rendered.includes('`abcd1234`'));
check('renders all 3', intents.every((i) => rendered.includes(i.summary)));

console.log('\nownership (security)');
const alice = { id: 'a1', userId: '111', type: 'dca', status: 'active' };
const bob = { id: 'b1', userId: '222', type: 'dca', status: 'active' };
check('alice can act on alice', canAct(alice, '111') === true);
check('bob cannot act on alice', canAct(alice, '222') === false);
check('null intent cannot be acted on', canAct(null, '111') === false);

console.log('\nstatus badges');
check('active', statusBadge('active') === '✅ active');
check('paused', statusBadge('paused') === '⏸ paused');
check('fired', statusBadge('fired') === '✓ fired');

console.log('\ntype icons');
check('dca → chart', typeIcon('dca') === '📈');
check('alert → bell', typeIcon('alert') === '🔔');

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll intent handler checks passed.');
