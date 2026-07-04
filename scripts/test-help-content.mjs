#!/usr/bin/env node
/**
 * Tests for src/helpContent.ts — the single source of truth for /help and
 * FAQ §2. Runs as a tsx script so we can import the TS source directly.
 *
 * Covers:
 *   • COMMANDS array integrity (count, uniqueness, no leading slash).
 *   • renderHelpLine / HELP_TEXT format and content.
 *   • renderFaqLines shape + bullet conventions.
 *   • Cross-drift guard: every Command appears verbatim in BOTH /help output
 *     and in FAQ §2, so adding a new command can't drift between the two.
 *   • FAQ_TEXT (in src/faq.ts) actually embeds the renderFaqLines() output,
 *     not a stale hand-written copy.
 */
import assert from 'node:assert/strict';

// ── Static env so config.ts zod-validation passes (transitive via faq.ts) ─
process.env.TELEGRAM_BOT_TOKEN ??= 'test_token_for_ci';
process.env.OPERATOR_PRIVATE_KEY ??= '0x' + '01'.repeat(32);
process.env.OG_COMPUTE_API_KEY ??= 'test_key_for_ci';
process.env.WALLET_ENCRYPTION_KEY ??= 'long_enough_encryption_key_for_ci';

const { COMMANDS, renderHelpLine, HELP_TEXT, renderFaqLines } = await import('../src/helpContent.ts');
const { FAQ_TEXT } = await import('../src/faq.ts');

let pass = 0;
let fail = 0;
function t(label, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✅ ${label}`);
  } catch (e) {
    fail++;
    console.error(`  ❌ ${label}`);
    console.error(`     ${e?.message ?? JSON.stringify(e)}`);
  }
}

console.log('helpContent — COMMANDS array integrity');

t('COMMANDS has the expected count', () => {
  // Don't hardcode — just verify it's sane. Hardcode once and the suite
  // becomes a tripwire for any add/remove on the SSOT itself.
  assert.ok(COMMANDS.length >= 15, `expected ≥15 commands, got ${COMMANDS.length}`);
});

t('every COMMANDS row has a non-empty name and description', () => {
  for (const c of COMMANDS) {
    assert.ok(c.name && c.name.length > 0, `name empty in row: ${JSON.stringify(c)}`);
    assert.ok(c.description && c.description.length > 0, `description empty in row: ${JSON.stringify(c)}`);
  }
});

t('every name is unique', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `duplicate names: ${names.join(', ')}`);
});

t('no name has a leading slash (slash is added by the renderer)', () => {
  for (const c of COMMANDS) {
    assert.ok(!c.name.startsWith('/'), `name has leading slash: ${c.name}`);
  }
});

t('every name is a valid /command identifier (letters, digits, underscore, lowercase)', () => {
  for (const c of COMMANDS) {
    assert.match(c.name, /^[a-z][a-z0-9_]*$/, `invalid command name: ${c.name}`);
  }
});

t('every example is non-empty when present and contains no Markdown that would break /help', () => {
  for (const c of COMMANDS) {
    if (c.example === undefined) continue;
    assert.ok(c.example.length > 0, `example empty for ${c.name}`);
    // Examples get wrapped in backticks by the renderer. If the example
    // itself contains a backtick, it would break the inline-code span.
    assert.ok(!c.example.includes('`'), `example contains a backtick which breaks inline-code: ${c.name}`);
  }
});

console.log('\nhelpContent — renderHelpLine format');

t('start (no example) renders without example suffix', () => {
  assert.equal(renderHelpLine({ name: 'start', description: 'x' }), '/start — x');
});

t('command WITH example renders example inside backticks', () => {
  const line = renderHelpLine({ name: 'foo', description: 'do foo', example: '/foo 0.1' });
  assert.ok(line.startsWith('/foo — do foo'), `line did not start with prefix: ${line}`);
  assert.ok(line.includes('`/foo 0.1`'), `example not backticked: ${line}`);
  assert.match(line, /\(e\.g\. `/, `missing "e.g. \`" marker: ${line}`);
});

t('renderer never produces double-slashes from a name with no leading slash', () => {
  const line = renderHelpLine({ name: 'import', description: 'd' });
  assert.ok(!line.includes('//'), `double slash in: ${line}`);
});

console.log('\nhelpContent — HELP_TEXT shape');

t('HELP_TEXT starts with "Commands:" header', () => {
  assert.ok(HELP_TEXT.startsWith('Commands:'), HELP_TEXT.slice(0, 60));
});

t('HELP_TEXT contains every command name with a leading slash', () => {
  for (const c of COMMANDS) {
    assert.ok(HELP_TEXT.includes(`/${c.name} —`), `missing /${c.name} in HELP_TEXT`);
  }
});

t('HELP_TEXT contains the closing "Tap the ❓ Help" pointer', () => {
  assert.ok(HELP_TEXT.includes('Tap the ❓ Help button'), 'footer line missing');
});

t('HELP_TEXT length is well under Telegram 4096-char single-message limit', () => {
  assert.ok(HELP_TEXT.length < 4096, `HELP_TEXT too long: ${HELP_TEXT.length}`);
});

console.log('\nhelpContent — renderFaqLines shape');

t('renderFaqLines returns one line per Command', () => {
  assert.equal(renderFaqLines().length, COMMANDS.length);
});

t('every FAQ line starts with the bullet "• "', () => {
  for (const line of renderFaqLines()) {
    assert.ok(line.startsWith('• '), `line missing bullet: ${JSON.stringify(line)}`);
  }
});

t('every FAQ line contains its command name inside backticks', () => {
  for (const c of COMMANDS) {
    const lines = renderFaqLines();
    const line = lines.find((l) => l.includes(`\`/${c.name}\``));
    assert.ok(line, `no FAQ line has backticked /${c.name}`);
    assert.ok(line.includes(c.description), `description missing in FAQ line for /${c.name}`);
  }
});

t('commands with examples have them backticked in the FAQ', () => {
  for (const c of COMMANDS) {
    if (!c.example) continue;
    const line = renderFaqLines().find((l) => l.includes(`\`/${c.name}\``));
    assert.ok(line);
    assert.ok(line.includes('`'), `no backticks in FAQ line for /${c.name} (expected backticked example)`);
    assert.ok(line.includes(c.example), `example text missing for /${c.name}`);
  }
});

console.log('\nhelpContent — /help ↔ FAQ §2 drift guard (SSOT)');

t('every command description appears verbatim in HELP_TEXT', () => {
  for (const c of COMMANDS) {
    assert.ok(HELP_TEXT.includes(c.description), `description "${c.description}" missing in /help`);
  }
});

t('every command description appears verbatim in FAQ_TEXT', () => {
  for (const c of COMMANDS) {
    assert.ok(FAQ_TEXT.includes(c.description), `description "${c.description}" missing in FAQ`);
  }
});

t('every renderFaqLines() entry appears verbatim inside FAQ_TEXT (no hand-written copy)', () => {
  for (const line of renderFaqLines()) {
    assert.ok(FAQ_TEXT.includes(line), `FAQ_TEXT missing rendered line: ${line}`);
  }
});

t('/import entry survives the SSOT and is backticked in both surfaces', () => {
  // /import was the original "missing button" / drift zone in earlier
  // rewrites. Verify it gets the same treatment everywhere.
  const helpLine = HELP_TEXT.split('\n').find((l) => l.startsWith('/import —'));
  const faqLine  = renderFaqLines().find((l) => l.includes('`/import`'));
  assert.ok(helpLine, '/import line missing from HELP_TEXT');
  assert.ok(faqLine,  '/import line missing from renderFaqLines()');
  assert.ok(helpLine.includes('inline preview'), 'help line missing "inline preview"');
  assert.ok(faqLine.includes('inline preview'),  'faq line missing "inline preview"');
  // /help puts the example in `backticks`, FAQ does too — same backtick form.
  assert.match(helpLine, /\(e\.g\. `no-arg = guided flow; \/import <key> = inline preview`\)/);
  assert.ok(faqLine.includes('`no-arg = guided flow; /import <key> = inline preview`'));
});

t('/swap concrete example appears in both surfaces (not just abstract syntax)', async () => {
  const helpLine = HELP_TEXT.split('\n').find((l) => l.startsWith('/swap —'));
  const faqLine = renderFaqLines().find((l) => l.includes('`/swap`'));
  assert.ok(helpLine.includes('`/swap 0.1 OG USDC`'), `help line missing /swap example: ${helpLine}`);
  assert.ok(faqLine.includes('`/swap 0.1 OG USDC`'),  `faq line missing /swap example: ${faqLine}`);
});

t('FAQ_TEXT is also under 4096 chars (Telegram single-message limit)', () => {
  assert.ok(FAQ_TEXT.length < 4096, `FAQ_TEXT too long: ${FAQ_TEXT.length}`);
});

t('FAQ_TEXT contains all numbered section headers (1. through 6.)', () => {
  // The section structure is documented in faq.ts's top-of-file contract.
  for (let i = 1; i <= 6; i++) {
    assert.ok(FAQ_TEXT.includes(`─ ${i}.`), `FAQ missing section ${i}`);
  }
});

console.log('\nhelpContent — renderer parity (same example formatting in both surfaces)');

t('renderHelpLine and renderFaqLines wrap examples in identical backtick form', () => {
  // For the commands with examples, the backticked-example substring should
  // appear in both rendered outputs. Bonus: the substring is byte-identical.
  for (const c of COMMANDS.filter((x) => x.example)) {
    const backticked = `\`${c.example}\``;
    const helpLine = renderHelpLine(c);
    const faqLine = renderFaqLines().find((l) => l.includes(`\`/${c.name}\``));
    assert.ok(helpLine.includes(backticked), `help missing backticked example for ${c.name}: ${helpLine}`);
    assert.ok(faqLine.includes(backticked),  `faq  missing backticked example for ${c.name}: ${faqLine}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('HELP_CONTENT_TESTS_FAILED');
  process.exit(1);
}
console.log('HELP_CONTENT_TESTS_PASSED');
