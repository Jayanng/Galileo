import { Contract, type ContractRunner, type Signer, type TransactionResponse } from 'ethers';
import { config } from '../config';
import { provider } from './chain';

/**
 * Wrapped OG (WOG) — a WETH9-style contract: native OG in, 1:1 WOG out, and back.
 * No canonical WOG exists on Galileo, so we deploy our own (scripts/deployWog.ts)
 * and point WOG_ADDRESS at it.
 */
const WOG_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

export function wogConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(config.WOG_ADDRESS);
}

export function wogContract(runner: ContractRunner = provider): Contract {
  return new Contract(config.WOG_ADDRESS, WOG_ABI, runner);
}

/** Wrap native OG → WOG (deposit). `amountWei` is in wei. */
export async function wrap(signer: Signer, amountWei: bigint): Promise<TransactionResponse> {
  return wogContract(signer).deposit({ value: amountWei }) as Promise<TransactionResponse>;
}

/** Unwrap WOG → native OG (withdraw). */
export async function unwrap(signer: Signer, amountWei: bigint): Promise<TransactionResponse> {
  return wogContract(signer).withdraw(amountWei) as Promise<TransactionResponse>;
}
