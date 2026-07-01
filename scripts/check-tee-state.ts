/**
 * TEE Broker diagnostics — checks:
 *   1. Operator wallet balance
 *   2. Available on-chain inference providers
 *   3. Main ledger balance
 *   4. Provider sub-account balances
 *
 * Run: npx tsx scripts/check-tee-state.ts
 */
import { initializeComputeBroker, getBroker, getActiveProviderAddress, isReady } from '../src/og/computeBroker';
import { operatorWallet, provider } from '../src/og/chain';

async function main() {
  console.log('\n=== TEE Broker Diagnostics ===\n');

  // 1. Operator wallet
  const walletBalance = await provider.getBalance(operatorWallet.address);
  console.log(`Operator wallet:  ${operatorWallet.address}`);
  console.log(`Wallet balance:   ${Number(walletBalance) / 1e18} OG`);
  console.log(`Chain ID:         ${(await provider.getNetwork()).chainId}\n`);

  // 2. Try to initialize compute broker (discovers providers)
  console.log('--- Broker Initialization ---');
  let services: Array<any> = [];
  try {
    await initializeComputeBroker();
    console.log('✅ Broker initialized successfully\n');
  } catch (e: any) {
    console.log(`❌ Broker init failed: ${e.message}\n`);
    // The new logging in computeBroker.ts already prints available services
    // We can't proceed to query ledger without a working broker
    console.log('Cannot query ledger without an active broker.');
    console.log('Diagnostic complete.\n');
    return;
  }

  // 3. Query main ledger
  if (isReady()) {
    const broker = getBroker();
    const providerAddr = getActiveProviderAddress();

    console.log('--- Main Ledger ---');
    try {
      const ledger = await broker.ledger.getLedger();
      console.log(`Main ledger balance: ${Number(ledger.totalBalance) / 1e18} OG (${ledger.totalBalance.toString()} wei)`);
    } catch (e: any) {
      console.log(`Could not read ledger: ${e.message}`);
    }

    console.log('\n--- Provider Info ---');
    console.log(`Active provider: ${providerAddr}`);

    // Get provider metadata
    try {
      const metadata = await broker.inference.getServiceMetadata(providerAddr!);
      console.log(`Endpoint:       ${metadata.endpoint}`);
      console.log(`Model:          ${metadata.model}`);
    } catch (e: any) {
      console.log(`Could not get metadata: ${e.message}`);
    }

    console.log('\n--- Sub-Account Balances ---');
    try {
      const providers = await broker.ledger.getProvidersWithBalance('inference') as Array<[string, bigint]>;
      let totalInSubAccounts = 0n;
      for (const [addr, balance] of providers) {
        const ogAmount = Number(balance) / 1e18;
        console.log(`  ${addr}: ${ogAmount.toFixed(6)} OG (${balance.toString()} wei)`);
        totalInSubAccounts += balance;
      }
      console.log(`\nTotal in sub-accounts: ${Number(totalInSubAccounts) / 1e18} OG`);
    } catch (e: any) {
      console.log(`Could not read sub-accounts: ${e.message}`);
    }
  }

  console.log('\n=== Diagnostic Complete ===');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
