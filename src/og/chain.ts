import {
  JsonRpcProvider,
  Network,
  Wallet,
  formatEther,
  parseEther,
  type TransactionResponse,
} from 'ethers';
import { config } from '../config';

// Pin the network so ethers doesn't probe for the chain id on every call.
const network = new Network('0g-galileo', config.OG_CHAIN_ID);

export const provider = new JsonRpcProvider(config.OG_RPC, network, {
  staticNetwork: network,
});

/** The single operator wallet: pays gas and signs Storage writes. */
export const operatorWallet = new Wallet(config.OPERATOR_PRIVATE_KEY, provider);

export async function getBalance(address: string): Promise<bigint> {
  return provider.getBalance(address);
}

export function formatOG(wei: bigint): string {
  return formatEther(wei);
}

/** Send native OG from the operator wallet (used to fund freshly created wallets). */
export async function dripGas(to: string, amountOG: string): Promise<TransactionResponse> {
  return operatorWallet.sendTransaction({ to, value: parseEther(amountOG) });
}
