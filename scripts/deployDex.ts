import 'dotenv/config';
import { createRequire } from 'node:module';
import { JsonRpcProvider, Wallet, ContractFactory, isAddress } from 'ethers';

/**
 * Deploy a Uniswap-V2 DEX (factory + router) on 0G Galileo — the venue that
 * makes real OG<->USDC/USDT swaps possible. The router's WETH is our WOG (a
 * WETH9 clone), so native-OG legs route through WOG automatically.
 *
 *   WOG_ADDRESS=0x.. OPERATOR_PRIVATE_KEY=0x.. npx tsx scripts/deployDex.ts
 *
 * Uses the canonical @uniswap/v2-core / v2-periphery artifacts (the deployed
 * pair init-code hash matches the router's, so pair addresses resolve). Run
 * scripts/deployWog.ts first; then deployMockTokens.ts + seedLiquidity.ts.
 */
const require = createRequire(import.meta.url);
const factoryArtifact = require('@uniswap/v2-core/build/UniswapV2Factory.json');
const routerArtifact = require('@uniswap/v2-periphery/build/UniswapV2Router02.json');

const hx = (s: string): string => (s.startsWith('0x') ? s : '0x' + s);

async function main(): Promise<void> {
  const rpc = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY;
  const wog = process.env.WOG_ADDRESS;
  if (!pkRaw) {
    console.error('Set OPERATOR_PRIVATE_KEY (and optionally OG_RPC) in your environment or .env.');
    process.exit(1);
  }
  if (!wog || !isAddress(wog)) {
    console.error('Set WOG_ADDRESS to your deployed WOG first (run `npx tsx scripts/deployWog.ts`).');
    process.exit(1);
  }
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(hx(pkRaw), provider);

  console.log('Deploying UniswapV2Factory from', wallet.address, 'on', rpc, '...');
  const Factory = new ContractFactory(factoryArtifact.abi, hx(factoryArtifact.bytecode), wallet);
  const factory = await Factory.deploy(wallet.address); // feeToSetter = operator
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log('  ✅ Factory:', factoryAddr);

  console.log('Deploying UniswapV2Router02 (WETH = WOG) ...');
  const Router = new ContractFactory(routerArtifact.abi, hx(routerArtifact.bytecode), wallet);
  const router = await Router.deploy(factoryAddr, wog);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log('  ✅ Router :', routerAddr);

  console.log('\nNext: set the secrets, then deploy mock tokens + seed liquidity.');
  console.log(
    '   fly secrets set DEX_ROUTER_ADDRESS=' + routerAddr + ' DEX_FACTORY_ADDRESS=' + factoryAddr + ' --app galielo',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
