import { Wallet } from 'ethers';
import { config } from '../config';
import { encrypt, decrypt } from './crypto';
import { walletStore, newWalletId, type WalletRecord } from './walletStore';
import { provider, getBalance, dripGas } from '../og/chain';

export interface WalletInfo {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

export interface WalletBalance extends WalletInfo {
  balance: bigint;
}

export interface WalletSecrets {
  id: string;
  name: string;
  address: string;
  privateKey: string;
  mnemonic: string | null;
}

function toInfo(rec: WalletRecord): WalletInfo {
  return { id: rec.id, name: rec.name, address: rec.address, createdAt: rec.createdAt };
}

/**
 * F4 — On-Chain Wallet Generator (multi-wallet).
 * Always creates a NEW wallet for the user. Default name is "Wallet N" (next index);
 * the caller can rename it afterwards. The private key and seed phrase are encrypted
 * before they're stored.
 */
export async function createWallet(userId: string, name?: string): Promise<WalletInfo> {
  const count = (await walletStore.list(userId)).length;
  const wallet = Wallet.createRandom();
  const rec: WalletRecord = {
    id: newWalletId(),
    name: name?.trim() || `Wallet ${count + 1}`,
    address: wallet.address,
    enc: encrypt(wallet.privateKey, config.WALLET_ENCRYPTION_KEY),
    // createRandom() yields a mnemonic; persist it (encrypted) so the owner can
    // back up the seed phrase later via /privatekey.
    ...(wallet.mnemonic
      ? { encMnemonic: encrypt(wallet.mnemonic.phrase, config.WALLET_ENCRYPTION_KEY) }
      : {}),
    createdAt: Date.now(),
  };
  await walletStore.add(userId, rec);

  if (config.WALLET_GAS_DRIP !== '0' && Number(config.WALLET_GAS_DRIP) > 0) {
    try {
      const tx = await dripGas(wallet.address, config.WALLET_GAS_DRIP);
      await tx.wait();
    } catch (e) {
      console.warn(`[wallet] gas drip to ${wallet.address} failed:`, (e as Error).message);
    }
  }
  return toInfo(rec);
}

export async function listWallets(userId: string): Promise<WalletInfo[]> {
  return (await walletStore.list(userId)).map(toInfo);
}

export async function getWallet(userId: string, walletId: string): Promise<WalletInfo | null> {
  const rec = await walletStore.get(userId, walletId);
  return rec ? toInfo(rec) : null;
}

export async function renameWallet(userId: string, walletId: string, name: string): Promise<void> {
  await walletStore.rename(userId, walletId, name.trim());
}

/** Decrypts a specific wallet's key into a provider-connected signer for on-chain actions. */
export async function getSigner(userId: string, walletId: string): Promise<Wallet | null> {
  const rec = await walletStore.get(userId, walletId);
  if (!rec) return null;
  return new Wallet(decrypt(rec.enc, config.WALLET_ENCRYPTION_KEY), provider);
}

/**
 * Decrypts a wallet's private key and (if stored) seed phrase for its owner.
 * Used ONLY by the explicit /privatekey reveal flow — never exposed as an AI tool.
 */
export async function getWalletSecrets(
  userId: string,
  walletId: string,
): Promise<WalletSecrets | null> {
  const rec = await walletStore.get(userId, walletId);
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    address: rec.address,
    privateKey: decrypt(rec.enc, config.WALLET_ENCRYPTION_KEY),
    mnemonic: rec.encMnemonic ? decrypt(rec.encMnemonic, config.WALLET_ENCRYPTION_KEY) : null,
  };
}

export async function getWalletBalance(userId: string, walletId: string): Promise<bigint | null> {
  const rec = await walletStore.get(userId, walletId);
  if (!rec) return null;
  return getBalance(rec.address);
}

export async function getAllBalances(userId: string): Promise<WalletBalance[]> {
  const wallets = await walletStore.list(userId);
  return Promise.all(
    wallets.map(async (w) => ({ ...toInfo(w), balance: await getBalance(w.address) })),
  );
}

export async function deleteWallet(userId: string, walletId: string): Promise<boolean> {
  const rec = await walletStore.get(userId, walletId);
  if (!rec) return false;
  await walletStore.remove(userId, walletId);
  return true;
}
