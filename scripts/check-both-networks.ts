import 'dotenv/config';
import { JsonRpcProvider, Wallet } from 'ethers';
import { operatorWallet } from '../src/og/chain';

const TESTNET_RPC = 'https://evmrpc-testnet.0g.ai';
const TESTNET_CHAIN_ID = 16602;
const MAINNET_RPC = 'https://evmrpc.0g.ai';
const MAINNET_CHAIN_ID = 16601;
// Use operatorWallet.address so ethers computes the correct checksum.
const ADDRESS = operatorWallet.address;

async function check(name: string, rpc: string, chainId: number): Promise<void> {
  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  try {
    const balance = await provider.getBalance(ADDRESS);
    const net = await provider.getNetwork();
    console.log(`[${name}] RPC=${rpc}`);
    console.log(`[${name}] chainId=${net.chainId} (expected ${chainId})`);
    console.log(`[${name}] balance=${balance.toString()} wei = ${Number(balance) / 1e18} OG`);
  } catch (e) {
    console.log(`[${name}] error: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log(`Address: ${ADDRESS}\n`);
  await check('TESTNET', TESTNET_RPC, TESTNET_CHAIN_ID);
  console.log('');
  await check('MAINNET', MAINNET_RPC, MAINNET_CHAIN_ID);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
