import { Contract, type ContractRunner, type Signer, type TransactionResponse } from 'ethers';
import { config } from '../config';
import { provider } from './chain';

/**
 * Pluggable Uniswap-V2-style DEX router adapter. Dormant until DEX_ROUTER_ADDRESS
 * is set to a router with liquidity on the current chain. The router's WETH() is
 * the wrapped-native token (WOG on 0G).
 */
const ROUTER_ABI = [
  'function WETH() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
];

export function dexConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(config.DEX_ROUTER_ADDRESS);
}

export function router(runner: ContractRunner = provider): Contract {
  return new Contract(config.DEX_ROUTER_ADDRESS, ROUTER_ABI, runner);
}

/** Expected output amount for `amountIn` along `path` (last element of getAmountsOut). */
export async function quoteOut(amountIn: bigint, path: string[]): Promise<bigint> {
  const amounts = (await router().getAmountsOut(amountIn, path)) as bigint[];
  return amounts[amounts.length - 1]!;
}

const deadline = (): bigint => BigInt(Math.floor(Date.now() / 1000) + config.SWAP_DEADLINE_SECS);

export async function swapExactNativeForTokens(
  signer: Signer,
  amountInWei: bigint,
  minOut: bigint,
  path: string[],
  to: string,
): Promise<TransactionResponse> {
  return router(signer).swapExactETHForTokens(minOut, path, to, deadline(), {
    value: amountInWei,
  }) as Promise<TransactionResponse>;
}

export async function swapExactTokensForNative(
  signer: Signer,
  amountInWei: bigint,
  minOut: bigint,
  path: string[],
  to: string,
): Promise<TransactionResponse> {
  return router(signer).swapExactTokensForETH(amountInWei, minOut, path, to, deadline()) as Promise<TransactionResponse>;
}

export async function swapExactTokensForTokens(
  signer: Signer,
  amountInWei: bigint,
  minOut: bigint,
  path: string[],
  to: string,
): Promise<TransactionResponse> {
  return router(signer).swapExactTokensForTokens(amountInWei, minOut, path, to, deadline()) as Promise<TransactionResponse>;
}
