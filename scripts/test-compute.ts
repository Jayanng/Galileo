/**
 * Quick test for 0G Compute connectivity.
 * Run with: npx tsx scripts/test-compute.ts
 */
import 'dotenv/config';
import { pingCompute } from '../src/og/compute';

async function main() {
  console.log('Pinging 0G Compute...');
  const start = Date.now();
  try {
    const result = await pingCompute();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Result (${elapsed}s):`, JSON.stringify(result, null, 2));
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`Error after ${elapsed}s:`, e.message);
    console.error(e);
  }
}

main();
