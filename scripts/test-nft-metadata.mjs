#!/usr/bin/env node
/**
 * test-nft-metadata.mjs
 *
 * Tests the /nft-metadata/:key endpoint handler in two ways:
 *   1. Direct function call — imports nftMetadataPage from proofCenter.ts
 *      and calls it with mock req/res objects to verify error handling
 *      (invalid key, missing storage, etc.)
 *   2. Live HTTP check — attempts to fetch from the bot's public URL
 *      (the Fly deployment) to verify the endpoint is reachable
 *
 * Run:
 *   npx tsx scripts/test-nft-metadata.mjs
 */

import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─── Set dummy env vars for config validation ───────────────────────────

process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
process.env.OPERATOR_PRIVATE_KEY = '0x' + '11'.repeat(32);
process.env.WALLET_ENCRYPTION_KEY = 'a'.repeat(32);
process.env.OG_COMPUTE_API_KEY = 'dummy-key';
process.env.NFT_CONTRACT_ADDRESS = '0xb18937EBc2361D1734339c8c68dFFcA9f4ED6e86';
process.env.OG_STORAGE_ENABLED = 'false'; // disable for unit test

// Import config so we can toggle storage on/off between tests
// (the config module caches env var values at import time, so we mutate
// the live object instead of changing process.env).
const { config } = await import('../src/config.ts');
const { nftMetadataPage } = await import('../src/proofCenter.ts');

// ─── Mock helpers ──────────────────────────────────────────────────────────

function mockRes() {
  const chunks = [];
  let statusCode = 200;
  let headers = {};
  return {
    writeHead: (code, hdrs) => {
      statusCode = code;
      headers = hdrs || {};
    },
    end: (data) => {
      chunks.push(Buffer.from(data));
    },
    _getStatus: () => statusCode,
    _getBody: () => Buffer.concat(chunks).toString('utf-8'),
    _getHeader: (k) => headers[k],
  };
}

function mockReq(url) {
  return { url };
}

// ─── CI detection ───────────────────────────────────────────────────────────

const IS_CI = process.env.CI === 'true';
if (IS_CI) {
  console.log('  ℹ  Running in CI — skipping live endpoint and network-dependent tests.');
}

// ─── Tests ─────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
async function t(label, fn) {
  try {
    await fn();
    pass++;
    console.log('  ✅ ' + label);
  } catch (e) {
    fail++;
    console.error('  ❌ ' + label);
    console.error('     ' + (e.message ?? JSON.stringify(e)));
  }
}

console.log('\n🧪 test-nft-metadata — Unit Tests\n');

// 1) Storage disabled returns 404
await t('returns 404 when OG_STORAGE_ENABLED=false', async () => {
  const res = mockRes();
  await nftMetadataPage(mockReq('/nft-metadata/test'), res, 'test');
  assert.equal(res._getStatus(), 404, 'expected 404');
  const body = JSON.parse(res._getBody());
  assert.equal(body.error, '0G Storage is disabled');
});

// 2) Invalid key returns 400
// Enable storage for remaining tests by mutating the live config object
// (process.env is already cached in config at import time).
config.OG_STORAGE_ENABLED = true;

await t('rejects empty key', async () => {
  const res = mockRes();
  await nftMetadataPage(mockReq('/nft-metadata/'), res, '');
  const body = JSON.parse(res._getBody());
  assert.ok(body.error || res._getStatus() >= 400, 'expected error for empty key');
});

await t('rejects path traversal keys', async () => {
  const res = mockRes();
  await nftMetadataPage(mockReq('/nft-metadata/../../etc/passwd'), res, '../../etc/passwd');
  const body = JSON.parse(res._getBody());
  assert.ok(body.error || res._getStatus() >= 400, 'expected error for path traversal');
});

await t('rejects keys with special characters', async () => {
  const res = mockRes();
  await nftMetadataPage(mockReq('/nft-metadata/<script>'), res, '<script>');
  const body = JSON.parse(res._getBody());
  assert.ok(body.error || res._getStatus() >= 400, 'expected error for special chars');
});

// 3) Valid key format is accepted (may still 404 since key doesn't exist in storage)
// Skip in CI: these call downloadJson which requires network access to the 0G Indexer.
if (!IS_CI) {
  await t('valid key format returns a response (404 if not found, not 400)', async () => {
    const res = mockRes();
    await nftMetadataPage(mockReq('/nft-metadata/test-key'), res, 'test-key');
    // Should be 404 (not found in storage), not 400 (invalid key)
    assert.equal(res._getStatus(), 404, 'expected 404 (key not in storage, but format valid)');
    const body = JSON.parse(res._getBody());
    assert.equal(body.error, 'Metadata not found', 'expected metadata not found');
  });

  await t('valid key with hyphens and underscores', async () => {
    const res = mockRes();
    await nftMetadataPage(mockReq('/nft-metadata/nft-user_123-abc'), res, 'nft-user_123-abc');
    assert.equal(res._getStatus(), 404, 'expected 404 (valid format but not in storage)');
  });
} else {
  console.log('  ℹ  Skipping 0G Storage network-dependent valid-key tests (CI).');
}

// 4) Source code check: verify health.ts route is wired correctly
const __dirname = dirname(fileURLToPath(import.meta.url));
const healthSource = readFileSync(join(__dirname, '..', 'src', 'health.ts'), 'utf8');
const proofCenterSource = readFileSync(join(__dirname, '..', 'src', 'proofCenter.ts'), 'utf8');

await t('health.ts imports nftMetadataPage', () => {
  assert.equal(
    healthSource.includes("nftMetadataPage"),
    true,
    'expected health.ts to import nftMetadataPage from proofCenter',
  );
});

await t('health.ts routes /nft-metadata/', () => {
  assert.equal(
    healthSource.includes("'/nft-metadata/'"),
    true,
    'expected health.ts to have a route for /nft-metadata/',
  );
});

await t('proofCenter.ts exports nftMetadataPage', () => {
  assert.equal(
    proofCenterSource.includes('export async function nftMetadataPage'),
    true,
    'expected proofCenter.ts to export nftMetadataPage',
  );
});

// ─── Live endpoint check (Fly deployment) ─────────────────────────────────
// Skipped in CI since no Fly deployment is available in the CI environment.

if (!IS_CI) {
  console.log('\n🌐 Live endpoint check (Fly.io)\n');

  // Try common Fly app names for the Galileo deployment
  const FLY_APPS = [
    'https://galileo-test.fly.dev',
    'https://galileo.fly.dev',
  ];

  let liveReachable = false;
  for (const baseUrl of FLY_APPS) {
    const url = `${baseUrl}/nft-metadata/test-key`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.status === 404) {
        const body = await resp.json();
        await t(`Live Fly endpoint returns 404 for missing key (${baseUrl})`, () => {
          assert.equal(body.error, 'Metadata not found');
        });
        console.log(`  ℹ  Endpoint reachable at ${baseUrl}/nft-metadata/:key`);
        liveReachable = true;
        break;
      } else if (resp.status === 200) {
        const body = await resp.json();
        await t(`Live Fly endpoint returns metadata (${baseUrl})`, () => {
          assert.ok(body.name || body.type, 'expected metadata object');
        });
        liveReachable = true;
        break;
      } else {
        console.log(`  ⚠  ${baseUrl}: unexpected status ${resp.status}`);
      }
    } catch (e) {
      console.log(`  ⚠  ${baseUrl}: not reachable (${e.message})`);
    }
  }

  if (!liveReachable) {
    console.log('  ℹ  No live Fly deployment was reachable. The endpoint will work once deployed.');
  }
} else {
  console.log('\n  ℹ  Skipping live Fly endpoint check in CI.');
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('NFT_METADATA_ENDPOINT_TESTS_FAILED');
  process.exit(1);
}
console.log('NFT_METADATA_ENDPOINT_TESTS_PASSED');
