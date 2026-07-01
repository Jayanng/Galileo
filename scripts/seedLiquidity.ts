import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, parseEther, formatEther, isAddress } from 'ethers';

/**
 * Seed OG<->USDC and OG<->USDT liquidity on the demo DEX so swaps execute.
 *
 *   OPERATOR_PRIVATE_KEY=0x.. DEX_ROUTER_ADDRESS=0x.. USDC_ADDRESS=0x.. \
 *   USDT_ADDRESS=0x.. npx tsx scripts/seedLiquidity.ts
 *
 * For each token: approve the router, then addLiquidityETH(OG + token). The
 * operator needs enough native OG (SEED_OG per pool, default 5 → 10 total) plus
 * gas, and the minted token supply from deployMockTokens.ts. Default price is
 * 1 OG = 1000 USDC/USDT (SEED_OG=5, SEED_TOKEN=5000). Verifies each pool with a
 * live getAmountsOut.
 */
const ROUTER_ABI = [
  'function WETH() view returns (address)',
  'function factory() view returns (address)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[])',
];
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

const hx = (s: string): string => (s.startsWith('0x') ? s : '0x' + s);

async function seedOne(
  wallet: Wallet,
  router: Contract,
  routerAddr: string,
  wog: string,
  token: string,
  ogWei: bigint,
  tokenWei: bigint,
): Promise<void> {
  const erc = new Contract(token, ERC20_ABI, wallet);
  const sym = (await erc.symbol()) as string;
  const bal = (await erc.balanceOf(wallet.address)) as bigint;
  if (bal < tokenWei) {
    throw new Error(`Operator holds ${formatEther(bal)} ${sym} but needs ${formatEther(tokenWei)} — run deployMockTokens.ts or lower SEED_TOKEN.`);
  }
  console.log(`Seeding ${formatEther(ogWei)} OG + ${formatEther(tokenWei)} ${sym} ...`);
  await (await erc.approve(routerAddr, tokenWei)).wait();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const tx = await router.addLiquidityETH(token, tokenWei, 0n, 0n, wallet.address, deadline, { value: ogWei });
  await tx.wait();
  const out = (await router.getAmountsOut(parseEther('1'), [wog, token])) as bigint[];
  console.log(`  ✅ ${sym} pool live — 1 OG ≈ ${formatEther(out[1]!)} ${sym}`);
}

async function main(): Promise<void> {
  const rpc = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';
  const pkRaw = process.env.OPERATOR_PRIVATE_KEY;
  const routerAddr = process.env.DEX_ROUTER_ADDRESS;
  const usdc = process.env.USDC_ADDRESS;
  const usdt = process.env.USDT_ADDRESS;
  if (!pkRaw) {
    console.error('Set OPERATOR_PRIVATE_KEY in your environment or .env.');
    process.exit(1);
  }
  if (!routerAddr || !isAddress(routerAddr)) {
    console.error('Set DEX_ROUTER_ADDRESS (run scripts/deployDex.ts first).');
    process.exit(1);
  }
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(hx(pkRaw), provider);
  const router = new Contract(routerAddr, ROUTER_ABI, wallet);
  const wog = (await router.WETH()) as string;

  const ogEach = parseEther(process.env.SEED_OG || '5');
  const tokenEach = parseEther(process.env.SEED_TOKEN || '5000');

  if (usdc && isAddress(usdc)) await seedOne(wallet, router, routerAddr, wog, usdc, ogEach, tokenEach);
  else console.log('USDC_ADDRESS not set — skipping USDC pool.');
  if (usdt && isAddress(usdt)) await seedOne(wallet, router, routerAddr, wog, usdt, ogEach, tokenEach);
  else console.log('USDT_ADDRESS not set — skipping USDT pool.');

  console.log('\nDone. OG<->USDC/USDT swaps are live — try the 🔄 Swap button or "swap 0.1 OG to USDC".');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
