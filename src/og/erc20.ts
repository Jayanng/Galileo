import { Contract, type ContractRunner } from 'ethers';
import { provider } from './chain';

/** Minimal ERC-20 surface used for balances, approvals, and metadata. */
export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export function erc20(address: string, runner: ContractRunner = provider): Contract {
  return new Contract(address, ERC20_ABI, runner);
}

export async function tokenMeta(address: string): Promise<{ symbol: string; decimals: number }> {
  const c = erc20(address);
  const [symbol, decimals] = await Promise.all([c.symbol() as Promise<string>, c.decimals() as Promise<bigint>]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}

export async function tokenBalance(token: string, owner: string): Promise<bigint> {
  return (await erc20(token).balanceOf(owner)) as bigint;
}

/** Approve `spender` for at least `amount` of `token`, if the current allowance is short. */
export async function ensureAllowance(
  token: string,
  owner: string,
  spender: string,
  amount: bigint,
  signer: ContractRunner,
): Promise<void> {
  const c = erc20(token, signer);
  const current = (await c.allowance(owner, spender)) as bigint;
  if (current >= amount) return;
  const tx = await c.approve(spender, amount);
  await tx.wait();
}
