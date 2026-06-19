import { Wallet } from 'ethers';
import { config } from '../config';
import { encrypt, decrypt } from './crypto';
import { walletStore, type WalletRecord } from './walletStore';
import { provider, getBalance, dripGas } from '../og/chain';

export interface CreateResult {
  address: string;
  created: boolean;
}

/**
 * F4 — On-Chain Wallet Generator.
 * Generates a fresh EOA for the Telegram user, encrypts the private key, and
 * persists it keyed by user id. Idempotent: returns the existing wallet if one
 * already exists. Optionally drips gas so the new wallet can transact.
 */
export async function createWallet(userId: string): Promise<CreateResult> {
  const existing = await walletStore.load(userId);
  if (existing) return { address: existing.address, created: false };

  const wallet = Wallet.createRandom();
  const rec: WalletRecord = {
    address: wallet.address,
    enc: encrypt(wallet.privateKey, config.WALLET_ENCRYPTION_KEY),
    createdAt: Date.now(),
  };
  await walletStore.save(userId, rec);

  if (config.WALLET_GAS_DRIP !== '0' && Number(config.WALLET_GAS_DRIP) > 0) {
    try {
      const tx = await dripGas(wallet.address, config.WALLET_GAS_DRIP);
      await tx.wait();
    } catch (e) {
      console.warn(`[wallet] gas drip to ${wallet.address} failed:`, (e as Error).message);
    }
  }

  return { address: wallet.address, created: true };
}

export async function getWalletAddress(userId: string): Promise<string | null> {
  const rec = await walletStore.load(userId);
  return rec?.address ?? null;
}

/** Decrypts the user's key into a provider-connected signer for on-chain actions. */
export async function getSigner(userId: string): Promise<Wallet | null> {
  const rec = await walletStore.load(userId);
  if (!rec) return null;
  const privateKey = decrypt(rec.enc, config.WALLET_ENCRYPTION_KEY);
  return new Wallet(privateKey, provider);
}

export async function getBalanceFor(userId: string): Promise<bigint | null> {
  const rec = await walletStore.load(userId);
  if (!rec) return null;
  return getBalance(rec.address);
}
