/**
 * Deposit OG from the operator wallet into the 0G Compute main ledger,
 * then top up the provider's inference sub-account.
 *
 * Run: npx tsx scripts/deposit-ledger.ts
 */
import { initializeComputeBroker, getBroker, getActiveProviderAddress, isReady, ensureSubAccountFunded } from '../src/og/computeBroker';
import { operatorWallet, provider } from '../src/og/chain';
import { parseEther, formatEther } from 'ethers';

async function main() {
  console.log('\n=== Ledger Funding ===\n');

  // 1. Check operator wallet
  const walletBalance = await provider.getBalance(operatorWallet.address);
  console.log(`Operator wallet: ${operatorWallet.address}`);
  console.log(`Wallet balance:  ${Number(walletBalance) / 1e18} OG\n`);

  // 2. Initialize broker
  console.log('Initializing broker...');
  try {
    await initializeComputeBroker();
  } catch (e: any) {
    console.error('Broker init failed:', e.message);
    process.exit(1);
  }

  if (!isReady()) {
    console.error('Broker not ready — is OG_COMPUTE_FALLBACK still true?');
    process.exit(1);
  }

  const broker = getBroker();
  const providerAddr = getActiveProviderAddress()!;

  // 3. Check main ledger
  console.log('\n--- Current State ---');
  const ledger = await broker.ledger.getLedger();
  console.log(`Main ledger: ${formatEther(ledger.totalBalance)} OG`);

  // 4. Deposit 5 OG from wallet to main ledger if balance < 10 OG
  const mainLedgerOG = Number(formatEther(ledger.totalBalance));
  if (mainLedgerOG < 10) {
    const depositAmount = 10 - Math.floor(mainLedgerOG);
    console.log(`\nDepositing ${depositAmount} OG from wallet to main ledger...`);
    try {
      await broker.ledger.depositFund(depositAmount);
      console.log('✅ depositFund succeeded');
      const refreshed = await broker.ledger.getLedger();
      console.log(`Main ledger now: ${formatEther(refreshed.totalBalance)} OG`);
    } catch (e: any) {
      console.error('❌ depositFund failed:', e.message);
      process.exit(1);
    }
  } else {
    console.log('Main ledger balance sufficient, skipping deposit.');
  }

  // 5. Top up sub-account
  console.log('\n--- Sub-Account Top-Up ---');
  await ensureSubAccountFunded(broker, providerAddr);

  // 6. Verify final state
  console.log('\n--- Final State ---');
  const finalLedger = await broker.ledger.getLedger();
  console.log(`Main ledger: ${formatEther(finalLedger.totalBalance)} OG`);

  const providers = await broker.ledger.getProvidersWithBalance('inference') as Array<[string, bigint]>;
  for (const [addr, balance] of providers) {
    if (addr.toLowerCase() === providerAddr.toLowerCase()) {
      console.log(`Sub-account: ${formatEther(balance)} OG`);
    }
  }

  console.log('\n✅ TEE funding complete. Bot can now use TEE inference.');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
