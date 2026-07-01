/**
 * Tests for src/intents/schedule.ts — natural-language schedule parser.
 *
 * Runs via `node scripts/test-intent-schedule.mjs`. Each block is a small set
 * of input/expected pairs with explicit assertions so failures are readable.
 */
import { parseSchedule, ScheduleParseError } from '../src/intents/schedule.ts';

let failed = 0;
function check(label, cond, detail = '') {
  if (cond) console.log(`  ✅ ${label}`);
  else {
    console.log(`  ❌ ${label} ${detail}`);
    failed++;
  }
}

console.log('parseSchedule: presets');
check('"daily" → 24h', parseSchedule('daily').intervalMs === 24 * 60 * 60 * 1000);
check('"weekly" → 7d', parseSchedule('weekly').intervalMs === 7 * 24 * 60 * 60 * 1000);
check('"hourly" → 1h', parseSchedule('hourly').intervalMs === 60 * 60 * 1000);
check('"DAILY" (case-insensitive)', parseSchedule('DAILY').intervalMs === 24 * 60 * 60 * 1000);

console.log('\nparseSchedule: "every N unit"');
check('"every 6 hours"', parseSchedule('every 6 hours').intervalMs === 6 * 60 * 60 * 1000);
check('"every 30 minutes"', parseSchedule('every 30 minutes').intervalMs === 30 * 60 * 1000);
check('"every 5 mins" (singular abbrev)', parseSchedule('every 5 mins').intervalMs === 5 * 60 * 1000);
check('"every 1 min"', parseSchedule('every 1 min').intervalMs === 60 * 1000);
check('"every 1 day"', parseSchedule('every 1 day').intervalMs === 24 * 60 * 60 * 1000);
check('"every 2 days"', parseSchedule('every 2 days').intervalMs === 2 * 24 * 60 * 60 * 1000);

console.log('\nparseSchedule: weekday names (v1 → 7d)');
for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
  const s = parseSchedule(`every ${day}`);
  check(`"every ${day}" → 7d`, s.intervalMs === 7 * 24 * 60 * 60 * 1000);
  check(`"every ${day}" preserves raw`, s.raw === `every ${day}`);
}

console.log('\nparseSchedule: raw preservation');
check('preserves raw for "daily"', parseSchedule('daily').raw === 'daily');
check('trims whitespace', parseSchedule('  every 6 hours  ').raw === 'every 6 hours');

console.log('\nparseSchedule: errors');
const cases = [
  '',
  '   ',
  'unknown',
  'every',
  'every 5',
  'every 0 hours',
  'every -1 minutes',
];
for (const c of cases) {
  let threw = false;
  try {
    parseSchedule(c);
  } catch (e) {
    threw = e instanceof ScheduleParseError;
  }
  check(`"${c}" throws ScheduleParseError`, threw);
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll schedule parser checks passed.');
