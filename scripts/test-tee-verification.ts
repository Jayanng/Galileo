/**
 * Smoke test for the TEE-verified inference path.
 *
 * Run with: npx tsx scripts/test-tee-verification.ts
 *
 * Steps:
 *   1. Initialize the 0G Compute Network broker (provider discovery, signer
 *      acknowledgement, optional top-up).
 *   2. Run a chat completion via `chatVerified`.
 *   3. Print the verification outcome (chatID + verified).
 *   4. Persist a proof via recordProof and read it back via getRecentProofs.
 *
 * Exits non-zero if any step fails.
 */

import 'dotenv/config';
import { initializeComputeBroker, getActiveProviderAddress } from '../src/og/computeBroker';
import { chatVerified } from '../src/og/compute';
import { recordProof, getRecentProofs } from '../src/ai/memory';

const TEST_USER = `tee-smoke-${Date.now()}`;

async function main(): Promise<void> {
  console.log('=== TEE VERIFICATION SMOKE TEST ===\n');

  console.log('[1/4] Initializing 0G Compute broker...');
  await initializeComputeBroker();
  const provider = getActiveProviderAddress();
  console.log(`      provider = ${provider}\n`);

  console.log('[2/4] Sending chat completion...');
  const t0 = Date.now();
  const result = await chatVerified(
    [{ role: 'user', content: 'Reply with exactly the word "ok" and nothing else.' }],
    undefined,
    { userContent: 'Reply with exactly the word "ok" and nothing else.' },
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`      elapsed = ${elapsed}s`);
  console.log(`      message.content = ${JSON.stringify(result.message.content)}`);
  console.log(`      chatID          = ${result.chatID ?? '(none)'}`);
  console.log(`      providerAddress = ${result.providerAddress ?? '(none)'}`);
  console.log(`      verified        = ${result.verified ?? '(null)'}\n`);

  if (result.chatID === null) {
    console.error('FAIL: chatID was null — provider did not return ZG-Res-Key header');
    process.exit(1);
  }
  if (result.verified === null) {
    console.error('FAIL: processResponse returned null — verification did not run');
    process.exit(1);
  }
  if (result.verified === false) {
    console.error('FAIL: processResponse returned false — signature verification failed');
    process.exit(1);
  }

  console.log('[3/4] Persisting proof via recordProof...');
  await recordProof(TEST_USER, {
    chatID: result.chatID!,
    providerAddress: result.providerAddress!,
    verified: result.verified,
  });
  console.log('      persisted\n');

  console.log('[4/4] Reading proof back via getRecentProofs...');
  const proofs = await getRecentProofs(TEST_USER, 5);
  console.log(`      found ${proofs.length} proof(s) for test user`);
  for (const p of proofs) {
    console.log(`        - ${p.chatID} verified=${p.verified} provider=${p.providerAddress}`);
  }
  console.log();

  if (proofs.length === 0) {
    console.error('FAIL: no proof read back');
    process.exit(1);
  }
  if (proofs[0].verified !== true) {
    console.error(`FAIL: latest proof verified=${proofs[0].verified}, expected true`);
    process.exit(1);
  }

  console.log('=== PASS: TEE verification round-trip succeeded ===');
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
