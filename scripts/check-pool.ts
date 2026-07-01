import 'dotenv/config';
import { Contract, isAddress, formatEther } from 'ethers';
import { provider } from '../src/og/chain';

/**
 * Verify a live OG<->USDC and OG<->USDT pool exists at the deployed router on
 * 0G Galileo. Prints pair addresses, reserves, and a sample price quote so an
 * operator can confirm liquidity is in place before launching a DCA feature.
 *
 *   npx tsx scripts/check-pool.ts
 *
 * Pure read-only diagnostic. No transactions are sent. If a pair is missing,
 * the script suggests `scripts/seedLiquidity.ts` to create it.
 */

const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address)'];
const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];
const ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];


async function checkOne(
  router: Contract,
  factoryAddr: string,
  wog: string,
  token: string,
  label: string,
): Promise<{ ok: boolean; pairAddr: string; price?: string }> {
  const factory = new Contract(factoryAddr, FACTORY_ABI, provider);
  const pairAddr = (await factory.getPair(wog, token)) as string;
  const isLive = pairAddr !== '0x0000000000000000000000000000000000000000';

  console.log(`\n[${label}]`);
  console.log(`  factory:  ${factoryAddr}`);
  console.log(`  pair:     ${pairAddr}${isLive ? '' : '  ← NOT CREATED'}`);

  if (!isLive) {
    console.log(`  status:   ❌ no pool — run \`npx tsx scripts/seedLiquidity.ts\` to create one.`);
    return { ok: false, pairAddr };
  }

  const pair = new Contract(pairAddr, PAIR_ABI, provider);
  const [reserve0, reserve1] = (await pair.getReserves()) as [bigint, bigint];
  const token0 = (await pair.token0()) as string;
  const reserveWog = token0.toLowerCase() === wog.toLowerCase() ? reserve0 : reserve1;
  const reserveTok = token0.toLowerCase() === wog.toLowerCase() ? reserve1 : reserve0;

  console.log(`  reserves: ${formatEther(reserveWog)} WOG  ·  ${formatEther(reserveTok)} ${label}`);
  console.log(`  status:   ✅ live`);

  const oneWogWei = BigInt('1000000000000000000');
  const out = (await router.getAmountsOut(oneWogWei, [wog, token])) as bigint[];
  const price = formatEther(out[out.length - 1]!);
  console.log(`  quote:    1 WOG → ${price} ${label}`);
  return { ok: true, pairAddr, price };
}

async function main(): Promise<void> {
  const routerAddr = process.env.DEX_ROUTER_ADDRESS;
  const wogAddr = process.env.WOG_ADDRESS;
  const usdc = process.env.USDC_ADDRESS;
  const usdt = process.env.USDT_ADDRESS;

  if (!routerAddr || !isAddress(routerAddr)) {
    console.error('DEX_ROUTER_ADDRESS is missing or invalid — run scripts/deployDex.ts first.');
    process.exit(1);
  }
  if (!wogAddr || !isAddress(wogAddr)) {
    console.error('WOG_ADDRESS is missing or invalid — run scripts/deployWog.ts first.');
    process.exit(1);
  }

  const router = new Contract(routerAddr, ROUTER_ABI, provider);
  const factoryAddr = (await router.factory()) as string;
  const wog = (await router.WETH()) as string;
  console.log('OG↔token pool check (0G Galileo)');
  console.log('================================');
  console.log(`router:    ${routerAddr}`);
  console.log(`WETH():    ${wog}${wog.toLowerCase() !== wogAddr.toLowerCase() ? `  (WOG_ADDRESS=${wogAddr} — MISMATCH)` : ''}`);
  console.log(`USDC:      ${usdc || '(not configured)'}`);
  console.log(`USDT:      ${usdt || '(not configured)'}`);

  const results: Array<{ label: string; ok: boolean }> = [];

  if (usdc && isAddress(usdc)) {
    const r = await checkOne(router, factoryAddr, wog, usdc, 'USDC');
    results.push({ label: 'OG↔USDC', ok: r.ok });
  } else {
    console.log('\n[OG↔USDC] skipped — USDC_ADDRESS not set.');
  }
  if (usdt && isAddress(usdt)) {
    const r = await checkOne(router, factoryAddr, wog, usdt, 'USDT');
    results.push({ label: 'OG↔USDT', ok: r.ok });
  } else {
    console.log('\n[OG↔USDT] skipped — USDT_ADDRESS not set.');
  }

  console.log('\nSummary');
  console.log('-------');
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}${r.ok ? '' : '  → seed via scripts/seedLiquidity.ts'}`);
  }
  const allOk = results.length > 0 && results.every((r) => r.ok);
  if (!allOk) {
    console.log('\nSome pools are missing. DCA into those tokens will fail at execution time.');
    process.exit(2);
  }
  console.log('\nAll configured pools are live. DCA intents can execute.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
