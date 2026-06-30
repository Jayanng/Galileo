import 'dotenv/config';
import { provider, operatorWallet } from '../src/og/chain';

async function main(): Promise<void> {
  const balance = await provider.getBalance(operatorWallet.address);
  console.log(`operator wallet: ${operatorWallet.address}`);
  console.log(`balance:         ${balance.toString()} wei`);
  console.log(`balance:         ${Number(balance) / 1e18} OG`);
  console.log(`chain id:        ${(await provider.getNetwork()).chainId}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
