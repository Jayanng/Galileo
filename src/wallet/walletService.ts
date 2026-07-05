import { Wallet } from 'ethers';
import { config } from '../config';
import { encrypt, decrypt } from './crypto';
import { walletStore, newWalletId, type WalletRecord } from './walletStore';
import { provider, getBalance, dripGas } from '../og/chain';
import { tokenBalance } from '../og/erc20';

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

export interface AssetBalance {
  symbol: string;
  balance: bigint;
}

/**
 * Status of the profile-NFT auto-mint that runs on first wallet creation.
 *
 * - minted       — first wallet ever, contract configured, mint succeeded.
 *                  Carries the on-chain tx hash + the F5 receipt id/root hash
 *                  (both may be null when receipt emission was disabled or
 *                  failed non-fatally).
 * - already_held — first wallet ever but the user already owns a profile
 *                  NFT (e.g. an externally minted one to this address).
 * - failed       — mint threw (RPC down / contract paused / out of gas).
 *                  The wallet is still created and usable; the caller may
 *                  want to surface this to the user.
 * - skipped      — wallet is not the user's first, OR NFT_CONTRACT_ADDRESS
 *                  is not configured. Nothing to surface.
 */
export type ProfileNftStatus =
  | {
      status: 'minted';
      txHash: string;
      tokenId: string;
      receiptId: string | null;
      receiptRootHash: string | null;
    }
  | { status: 'already_held' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: string };

export interface CreateWalletResult {
  wallet: WalletInfo;
  profileNft: ProfileNftStatus;
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
export async function createWallet(userId: string, name?: string): Promise<CreateWalletResult> {
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

  // Auto-mint profile NFT on very first wallet creation (one per user, soulbound).
  // The result is surfaced so chat handlers can render the Agent NFT tx line in
  // the create-wallet caption. Best-effort — a failure does not block wallet
  // creation.
  let profileNft: ProfileNftStatus = { status: 'skipped', reason: 'not_first_wallet' };
  if (count === 0) {
    try {
      const { hasProfileNft, mintProfileNft, nftConfigured } = await import('../og/nftService');
      if (!nftConfigured()) {
        profileNft = { status: 'skipped', reason: 'nft_not_configured' };
      } else {
        const alreadyHas = await hasProfileNft(wallet.address);
        if (alreadyHas) {
          profileNft = { status: 'already_held' };
        } else {
          const result = await mintProfileNft(
            userId,
            rec.id,
            rec.name,
            wallet.address,
            rec.createdAt,
            1,
          );
          profileNft = {
            status: 'minted',
            txHash: result.txHash,
            tokenId: result.tokenId,
            receiptId: result.receiptId,
            receiptRootHash: result.receiptRootHash,
          };
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`[wallet] profile NFT auto-mint failed: ${msg}`);
      profileNft = { status: 'failed', error: msg };
    }
  }

  if (config.WALLET_GAS_DRIP !== '0' && Number(config.WALLET_GAS_DRIP) > 0) {
    try {
      const tx = await dripGas(wallet.address, config.WALLET_GAS_DRIP);
      await tx.wait();
    } catch (e) {
      console.warn(`[wallet] gas drip to ${wallet.address} failed:`, (e as Error).message);
    }
  }
  return { wallet: toInfo(rec), profileNft };
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

/**
 * Total on-chain transactions initiated across all the user's wallets.
 * An address's nonce equals the number of transactions it has sent, so summing
 * nonces gives the true count of outgoing txs (best-effort per wallet).
 */
export async function getOnChainTxCount(userId: string): Promise<number> {
  const wallets = await walletStore.list(userId);
  const counts = await Promise.all(
    wallets.map(async (w) => {
      try {
        return await provider.getTransactionCount(w.address);
      } catch {
        return 0;
      }
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Configured non-native tokens (WOG, USDC, USDT) that have an address set. */
function configuredTokens(): { symbol: string; address: string }[] {
  const list: { symbol: string; address: string }[] = [];
  if (config.WOG_ADDRESS) list.push({ symbol: 'WOG', address: config.WOG_ADDRESS });
  if (config.USDC_ADDRESS) list.push({ symbol: 'USDC', address: config.USDC_ADDRESS });
  if (config.USDT_ADDRESS) list.push({ symbol: 'USDT', address: config.USDT_ADDRESS });
  return list;
}

/**
 * Native OG plus each configured token's balance for a wallet address.
 * Token reads are best-effort — a failed RPC shows 0 rather than breaking the
 * dashboard. All demo tokens are 18-decimal (WETH9-clone WOG, mock USDC/USDT),
 * so callers can format with the same formatOG used for native OG.
 */
export async function getWalletAssets(address: string): Promise<AssetBalance[]> {
  let ogBalance = 0n;
  try {
    ogBalance = await getBalance(address);
  } catch {
    ogBalance = 0n;
  }
  const tokenBalances = await Promise.all(
    configuredTokens().map(async (t) => {
      try {
        return { symbol: t.symbol, balance: await tokenBalance(t.address, address) };
      } catch {
        return { symbol: t.symbol, balance: 0n };
      }
    }),
  );
  return [{ symbol: 'OG', balance: ogBalance }, ...tokenBalances];
}
