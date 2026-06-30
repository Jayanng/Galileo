import 'dotenv/config';
import { putKV, getKV } from '../src/og/storage';

async function main() {
  console.log('Testing 0G Storage KV...');
  const key = 'test:' + Date.now();
  const val = new TextEncoder().encode(JSON.stringify({ ok: true, ts: Date.now() }));
  
  console.log('Writing key:', key);
  try {
    const res = await putKV(key, val);
    console.log('Write result:', JSON.stringify(res));
  } catch (e) {
    console.error('Write failed:', e instanceof Error ? e.message : String(e));
  }

  console.log('Reading key:', key);
  try {
    const data = await getKV(key);
    if (data) {
      console.log('Read result:', new TextDecoder().decode(data));
    } else {
      console.log('Read returned null (no data yet)');
    }
  } catch (e) {
    console.error('Read failed:', e instanceof Error ? e.message : String(e));
  }

  console.log('Done.');
}

main().catch(console.error);
