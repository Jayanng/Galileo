import 'dotenv/config';
import { search, getRecent } from '../src/ai/memory';

const USER_ID = '744541170';

async function main() {
  console.log('=== MEMORY DIAGNOSTIC ===\n');

  // Test 1: getRecent
  console.log('Test 1: getRecent (last 10 messages)');
  const recent = await getRecent(USER_ID, 10);
  console.log('  Results:', recent.length);
  for (const m of recent) {
    console.log('  [' + m.role + '] ' + m.content.slice(0, 100));
  }

  // Test 2: search all
  console.log('\nTest 2: search (all entries, no filter)');
  const all = await search(USER_ID, undefined, undefined, undefined, 15);
  console.log('  Results:', all.length);
  for (const e of all) {
    const ts = new Date(e.ts).toLocaleString();
    if ('role' in e && e.kind === 'msg') {
      const m = e as any;
      console.log('  [msg][' + ts + '] ' + m.role + ': ' + (m.content || '').slice(0, 100));
    } else if (e.kind === 'tool') {
      console.log('  [tool][' + ts + '] ' + (e as any).tool);
    }
  }

  // Test 3: verify index
  console.log('\nTest 3: Index check');
  const fs = await import('fs');
  try {
    const index = JSON.parse(fs.readFileSync('.data/root-index.json', 'utf-8'));
    console.log('  User in index:', USER_ID in index);
    if (USER_ID in index) {
      console.log('  rootHash:', index[USER_ID]);
    }
    console.log('  Total users in index:', Object.keys(index).length);
  } catch (e: any) {
    console.log('  Error reading index:', e.message);
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
}

main().catch(e => console.error('Error:', e));
