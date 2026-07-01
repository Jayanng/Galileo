#!/usr/bin/env node
// Standalone test for portfolio + snapshot logic — inlines all functions
// so we can run via plain `node` (no TS compilation). Mirrors the patterns
// in src/og/portfolio.ts and src/analytics/snapshot.ts.

// --------------- inlined snapshot module (mirrors src/analytics/snapshot.ts) ---------------
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let SNAPSHOT_DIR = join(tmpdir(), 'galileo-test-snapshots');

function resetSnapshotDir() {
  SNAPSHOT_DIR = join(tmpdir(), 'galileo-test-snapshots-' + Date.now());
}

function snapshotPath(userId) {
  return join(SNAPSHOT_DIR, `${userId}.json`);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function recordSnapshot(userId, totalUsd, assets) {
  const path = snapshotPath(userId);
  const today = dayKey(new Date());
  let data = {};
  if (existsSync(path)) {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } else {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  data[today] = { totalUsd, assets, ts: Date.now() };
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function getSnapshots(userId, daysBack) {
  const path = snapshotPath(userId);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const now = new Date();
  const entries = Object.entries(data);
  let filtered;
  if (daysBack) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - daysBack);
    const cutoffStr = dayKey(cutoff);
    filtered = entries.filter(([k]) => k >= cutoffStr);
  } else {
    filtered = entries;
  }
  filtered.sort((a, b) => b[0].localeCompare(a[0]));
  return filtered.map(([date, snap]) => ({ date, totalUsd: snap.totalUsd, assets: snap.assets }));
}

function clearSnapshots(userId) {
  const path = snapshotPath(userId);
  if (existsSync(path)) unlinkSync(path);
}

// --------------- inlined renderPortfolioMarkdown (mirrors src/og/portfolio.ts) ---------------

function formatUsd(usd) {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '$' + usd.toFixed(6);
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderPortfolioMarkdown(entries) {
  // entries: [{ walletName, address, assets: [{ symbol, balance, usd }], walletTotalUsd }]
  const rows = [];
  for (const e of entries) {
    rows.push(`**${e.walletName}** (\`${e.address.slice(0, 10)}…\`)`);
    for (const a of e.assets) {
      rows.push(`  ${a.symbol}: ${a.balance} (${formatUsd(a.usd)})`);
    }
    rows.push(`  *Total: ${formatUsd(e.walletTotalUsd)}*`);
  }
  return rows.join('\n');
}

// --------------- inlined P&L computation (mirrors src/handlers/portfolioHandlers.ts) ---------------

function computePL(snapshots) {
  if (snapshots.length < 2) return { change: 0, changePct: 0, baseline: snapshots[0]?.totalUsd ?? 0 };
  const baseline = snapshots[snapshots.length - 1].totalUsd;
  const current = snapshots[0].totalUsd;
  const change = current - baseline;
  const changePct = baseline > 0 ? ((change / baseline) * 100) : 0;
  return { change, changePct, baseline };
}

function buildHistoryTable(snapshots) {
  const lines = ['Date | Total USD | % Change'];
  lines.push('--- | --- | ---');
  if (snapshots.length === 0) return lines.join('\n');
  const baseline = snapshots[snapshots.length - 1].totalUsd;
  for (const s of snapshots) {
    const pct = baseline > 0 ? (((s.totalUsd - baseline) / baseline) * 100).toFixed(1) : '—';
    lines.push(`${s.date} | ${formatUsd(s.totalUsd)} | ${pct}%`);
  }
  return lines.join('\n');
}

// --------------- tests ---------------
let pass = 0;
let fail = 0;

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`);
  }
}

function assertApprox(actual, expected, tolerance, name) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  expected ~${expected} (±${tolerance})\n  actual=${actual}`);
  }
}

function assertMatch(actual, pattern, name) {
  const ok = pattern.test(actual);
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else {
    fail++;
    console.log(`FAIL  ${name}\n  pattern=${pattern}\n  actual=${JSON.stringify(actual)}`);
  }
}

// ==================== Test Suite ====================

// --- Portfolio Rendering ---
console.log('\n--- Portfolio Rendering ---');
const portfolio = [
  {
    walletName: 'Wallet 1',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    assets: [
      { symbol: 'OG', balance: '100.0', usd: 50.0 },
      { symbol: 'WOG', balance: '50.0', usd: 25.0 },
      { symbol: 'USDC', balance: '200.0', usd: 200.0 },
    ],
    walletTotalUsd: 275.0,
  },
  {
    walletName: 'Wallet 2',
    address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    assets: [
      { symbol: 'OG', balance: '10.0', usd: 5.0 },
      { symbol: 'WOG', balance: '0.0', usd: 0.0 },
    ],
    walletTotalUsd: 5.0,
  },
];

const rendered = renderPortfolioMarkdown(portfolio);
assertMatch(rendered, /Wallet 1/, 'renders wallet name');
assertMatch(rendered, /OG.*100/, 'renders OG balance');
assertMatch(rendered, /USDC.*200/, 'renders USDC');
assertMatch(rendered, /Wallet 2/, 'renders second wallet');
assertMatch(rendered, /\$275\.00/, 'renders total USD for wallet 1');
assertMatch(rendered, /\$5\.00/, 'renders total USD for wallet 2');
assertMatch(rendered, /0x12345678…/, 'renders truncated address');
assertMatch(rendered, /0xdeadbeef…/, 'renders second truncated address');

// --- formatUsd ---
console.log('\n--- formatUsd ---');
assertEq(formatUsd(0), '$0.00', 'zero');
assertEq(formatUsd(1234.5), '$1,234.50', 'large value with commas');
assertEq(formatUsd(0.005), '$0.005000', 'sub-cent shows 6 decimals');
assertEq(formatUsd(100), '$100.00', 'round number');

// --- Snapshot Recording & Retrieval ---
console.log('\n--- Snapshots ---');
resetSnapshotDir();
const userId = 'test-user-1';

// Empty before any snapshot
assertEq(getSnapshots(userId).length, 0, 'no snapshots yet');

// Record a snapshot
recordSnapshot(userId, 100.0, [{ symbol: 'OG', balance: '200', usd: 100 }]);
assertEq(getSnapshots(userId).length, 1, 'one snapshot after record');
assertEq(getSnapshots(userId)[0].totalUsd, 100.0, 'snapshot value matches');

// Record another snapshot for a different day
// Manually write a past date to simulate
const pastKey = '2026-01-01';
const snapPath = join(SNAPSHOT_DIR, `${userId}.json`);
const currentData = JSON.parse(readFileSync(snapPath, 'utf8'));
currentData[pastKey] = { totalUsd: 50.0, assets: [{ symbol: 'OG', balance: '100', usd: 50 }], ts: Date.now() };
writeFileSync(snapPath, JSON.stringify(currentData, null, 2), 'utf8');

assertEq(getSnapshots(userId).length, 2, 'two snapshots after adding past date');
assertEq(getSnapshots(userId)[0].totalUsd, 100.0, 'newest first');
assertEq(getSnapshots(userId)[1].totalUsd, 50.0, 'oldest second');

// Date filtering (3 days back — should only include today)
assertEq(getSnapshots(userId, 3).length, 1, '3-day filter excludes Jan snapshot');

// Clear
clearSnapshots(userId);
assertEq(getSnapshots(userId).length, 0, 'cleared');

// --- P&L Computation ---
console.log('\n--- P&L Computation ---');
const snapshotsPL = [
  { date: '2026-06-30', totalUsd: 200.0, assets: [] },
  { date: '2026-06-29', totalUsd: 150.0, assets: [] },
  { date: '2026-06-28', totalUsd: 100.0, assets: [] },
];
const pl = computePL(snapshotsPL);
assertApprox(pl.change, 100.0, 0.001, 'P&L change = +100');
assertApprox(pl.changePct, 100.0, 0.001, 'P&L change% = +100%');
assertApprox(pl.baseline, 100.0, 0.001, 'baseline = first value');

// Single snapshot case
assertEq(computePL([snapshotsPL[0]]).change, 0, 'single snapshot = zero change');

// Empty case
assertEq(computePL([]).baseline, 0, 'empty = baseline 0');

// --- History Table Rendering ---
console.log('\n--- History Table ---');
const table = buildHistoryTable(snapshotsPL);
assertMatch(table, /Date/, 'table header has Date');
assertMatch(table, /\$200\.00/, 'table shows current value');
assertMatch(table, /\$100\.00/, 'table shows baseline value');
assertMatch(table, /100\.0%/, 'table shows 100% change');
assertMatch(table, /2026-06-28/, 'table shows dates');

// --- Summary ---
console.log('\n---');
console.log(`passed=${pass} failed=${fail}`);
if (fail === 0) console.log(`ALL_TESTS_PASS (${pass}/${pass})`);
process.exit(fail === 0 ? 0 : 1);
