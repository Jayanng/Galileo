/**
 * Integration tests for src/ai/memory.ts (File Mode version).
 *
 * Run with: npx tsx src/ai/memory.test.ts
 *
 * Prerequisites:
 *   - .env has OG_MEMORY_ENABLED=true and OG_STORAGE_ENABLED=true
 *   - .env has OG_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
 *   - .env has OG_RPC=https://evmrpc-testnet.0g.ai
 *   - .env has OG_STORAGE_INDEX_PATH set (default '.data/root-index.json' works)
 *   - Operator wallet has testnet OG for gas
 */

import 'dotenv/config';
import {
  recordMessage,
  recordToolCall,
  getRecent,
  search,
  clearMemory,
} from './memory';

const TEST_USER = `test-user-${Date.now()}`;
const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ${PASS} ${message}`);
  } else {
    console.log(`  ${FAIL} ${message}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log(`\n🧪 Memory tests (File Mode) — user: ${TEST_USER}\n`);

  // Test 1: recordMessage + getRecent
  console.log('Test 1: recordMessage + getRecent');
  await recordMessage(TEST_USER, 'user', 'hello world');
  await recordMessage(TEST_USER, 'assistant', 'hi there');
  const recent = await getRecent(TEST_USER, 10);
  assert(recent.length === 2, `expected 2 recent messages, got ${recent.length}`);
  assert(
    recent.some((m) => m.content === 'hello world'),
    'hello world message was persisted',
  );
  assert(
    recent.some((m) => m.content === 'hi there'),
    'hi there message was persisted',
  );

  // Test 2: search by query
  console.log('\nTest 2: search by query');
  const results = await search(TEST_USER, 'hello');
  assert(results.length >= 1, `search "hello" returned ≥1 result, got ${results.length}`);
  assert(
    results.some((r) => r.kind === 'msg'),
    'search results include a message',
  );

  // Test 3: search by time range
  console.log('\nTest 3: search by time range');
  const now = Date.now();
  const futureResults = await search(TEST_USER, undefined, now + 10000);
  assert(futureResults.length === 0, 'search with future fromTs returns 0 results');

  const pastResults = await search(TEST_USER, undefined, 0, now + 10000);
  assert(pastResults.length >= 2, `search past returns ≥2 results, got ${pastResults.length}`);

  // Test 4: recordToolCall
  console.log('\nTest 4: recordToolCall');
  await recordToolCall(TEST_USER, 'create_wallet', { name: 'test' }, { success: true, data: { id: 'abc' } });
  const toolResults = await search(TEST_USER, 'create_wallet');
  assert(toolResults.length >= 1, `search "create_wallet" returned ≥1 result, got ${toolResults.length}`);
  assert(
    toolResults.some((r) => r.kind === 'tool'),
    'search results include a tool call',
  );

  // Test 5: clearMemory
  console.log('\nTest 5: clearMemory');
  await clearMemory(TEST_USER);
  const afterClear = await getRecent(TEST_USER, 10);
  assert(afterClear.length === 0, 'getRecent returns 0 after clearMemory');

  console.log('\n✅ All tests complete\n');
}

main().catch((e) => {
  console.error('Test runner failed:', e);
  process.exit(1);
});
