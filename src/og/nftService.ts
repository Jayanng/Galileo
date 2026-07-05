import { Contract, type Signer, type ContractRunner } from 'ethers';
import { config } from '../config';
import { provider, operatorWallet } from './chain';
import { uploadJson } from './fileStorage';

const NFT_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function mint(address to, string uri) returns (uint256)',
  'function setTokenURI(uint256 tokenId, string uri)',
  'function profileOf(address) view returns (uint256)',
  'function hasProfile(address) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event MetadataUpdate(uint256 indexed tokenId)',
];

export function nftConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(config.NFT_CONTRACT_ADDRESS);
}

function contract(runner: ContractRunner = provider): Contract {
  return new Contract(config.NFT_CONTRACT_ADDRESS, NFT_ABI, runner);
}

// ─── Profile metadata schema (stored on 0G Storage) ─────────────────────

export interface NftProfileMetadata {
  name: string;
  description: string;
  /** "Galileo Agent Profile" */
  type: string;
  /** Unix-ms timestamp of first wallet creation (birth) */
  created_at: number;
  /** ISO-8601 string for human display */
  created_at_iso: string;
  /** Number of wallets owned at mint time */
  wallet_count: number;
  /** 0G Galileo chain ID */
  chain_id: number;
  attributes: Array<{ trait_type: string; value: string | number }>;
}

function buildMetadata(
  userId: string,
  userAddress: string,
  createdAt: number,
  walletCount: number,
): NftProfileMetadata {
  return {
    name: `Galileo Agent #${userId.slice(-6)}`,
    description: `Profile NFT for Galileo agent ${userId.slice(-6)} on 0G Galileo. Soulbound — non-transferable identity badge.`,
    type: 'Galileo Agent Profile',
    created_at: createdAt,
    created_at_iso: new Date(createdAt).toISOString(),
    wallet_count: walletCount,
    chain_id: config.OG_CHAIN_ID,
    attributes: [
      { trait_type: 'User ID Hash', value: userId.slice(0, 8) },
      { trait_type: 'Wallets Owned', value: walletCount },
      { trait_type: 'Chain', value: '0G Galileo Testnet' },
      { trait_type: 'Soulbound', value: 'Yes' },
      { trait_type: 'Agent Since', value: new Date(createdAt).toISOString().slice(0, 10) },
    ],
  };
}

// ─── Mint ───────────────────────────────────────────────────────────────

export interface MintResult {
  tokenId: string;
  txHash: string;
  metadata: NftProfileMetadata;
  rootHash: string | null;
  /** F5 receipt id; null when Storage receipt emission was disabled or failed. */
  receiptId: string | null;
  /** F5 receipt root hash (0G Storage key under `receipt:<id>`). */
  receiptRootHash: string | null;
}

/**
 * Mint a profile NFT for a user's wallet address. Called on first wallet creation.
 *
 * 1. Builds the profile metadata JSON
 * 2. Uploads it to 0G Storage (best-effort — falls back to a data URI)
 * 3. Mints the NFT on-chain (operator wallet pays gas)
 * 4. Emits an F5 Verified Intent Receipt (`actionType: 'nft_mint'`) capturing
 *    the on-chain mint + the receipt itself under `receipt:<id>` on 0G Storage.
 *    The receipt emission is best-effort: it never blocks the on-chain mint
 *    and never causes a wallet-creation failure.
 * 5. Returns tokenId, txHash, metadata, and (when available) the F5 receipt id
 *    + storage root hash so callers can render the `/verify/:rootHash` link.
 *
 * Reverts if the user already has a profile NFT.
 */
export async function mintProfileNft(
  userId: string,
  walletId: string,
  walletName: string,
  userAddress: string,
  createdAt: number,
  walletCount: number,
): Promise<MintResult> {
  if (!nftConfigured()) {
    throw new Error('NFT contract not configured — set NFT_CONTRACT_ADDRESS in .env');
  }

  const c = contract(operatorWallet);
  const metadata = buildMetadata(userId, userAddress, createdAt, walletCount);

  // Upload metadata to 0G Storage, fall back to data URI
  let tokenUri: string;
  let rootHash: string | null = null;

  if (config.OG_STORAGE_ENABLED) {
    try {
      const metaKey = `nft-${userId}`;
      rootHash = await uploadJson(metaKey, metadata as unknown as Record<string, unknown>);
      tokenUri = `0g://${rootHash}`;
    } catch (e) {
      console.warn(`[nft] 0G Storage upload failed, using data URI: ${(e as Error).message}`);
      tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
    }
  } else {
    tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
  }

  const tx = await (c.mint(userAddress, tokenUri) as Promise<{ wait: () => Promise<{ hash: string }> }>);
  const receipt = await tx.wait();
  const txHash = receipt.hash;

  // Read back the tokenId from the contract (profileOf)
  const tokenIdBig: bigint = await c.profileOf(userAddress);
  const tokenId = tokenIdBig.toString();

  console.log(
    `[nft] minted profile NFT tokenId=${tokenId} for user=${userId} address=${userAddress} tx=${txHash}`,
  );

  // F5: emit a Verified Intent Receipt capturing this mint. Lazy-import so the
  // receipts module doesn't have to load on every cold start. Receipt failure
  // is non-fatal — the on-chain mint has already succeeded.
  let receiptId: string | null = null;
  let receiptRootHash: string | null = null;
  try {
    const { createNftMintReceipt } = await import('../receipts');
    const r = await createNftMintReceipt({
      userId,
      walletId,
      walletName,
      walletAddress: userAddress,
      tokenId,
      tokenURI: tokenUri,
      metadataStorageRootHash: rootHash,
      txHash,
    });
    receiptId = r.receiptId;
    receiptRootHash = r.rootHash;
    if (receiptRootHash) {
      console.log(`[nft] F5 receipt emitted receiptId=${receiptId} rootHash=${receiptRootHash}`);
    }
  } catch (e) {
    console.warn(`[nft] F5 receipt emission failed (non-fatal): ${(e as Error).message}`);
  }

  return { tokenId, txHash, metadata, rootHash, receiptId, receiptRootHash };
}

// ─── Query ───────────────────────────────────────────────────────────────

export interface NftDetail {
  tokenId: string;
  owner: string;
  tokenURI: string;
  name: string;
  symbol: string;
  totalSupply: string;
  metadata: NftProfileMetadata | null;
}

/**
 * Get detailed info for a user's profile NFT.
 * Returns null if the user doesn't have one or if the contract isn't configured.
 */
export async function getProfileNft(userAddress: string): Promise<NftDetail | null> {
  if (!nftConfigured()) return null;

  const c = contract();
  const tokenIdBig: bigint = await c.profileOf(userAddress);
  if (tokenIdBig === 0n) return null;

  const tokenId = tokenIdBig.toString();
  const [name, symbol, totalSupply, tokenURI] = await Promise.all([
    c.name() as Promise<string>,
    c.symbol() as Promise<string>,
    c.totalSupply() as Promise<bigint>,
    c.tokenURI(tokenIdBig) as Promise<string>,
  ]);

  let metadata: NftProfileMetadata | null = null;
  if (tokenURI.startsWith('data:application/json;base64,')) {
    try {
      const b64 = tokenURI.replace('data:application/json;base64,', '');
      metadata = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    } catch { /* not critical */ }
  }

  return {
    tokenId,
    owner: userAddress,
    tokenURI,
    name,
    symbol,
    totalSupply: totalSupply.toString(),
    metadata,
  };
}

/**
 * Check if a user address already has a profile NFT.
 */
export async function hasProfileNft(userAddress: string): Promise<boolean> {
  if (!nftConfigured()) return false;
  return (await contract().hasProfile(userAddress)) as boolean;
}

/**
 * Get total number of profile NFTs minted.
 */
export async function getTotalProfiles(): Promise<number> {
  if (!nftConfigured()) return 0;
  const supply: bigint = await contract().totalSupply();
  return Number(supply);
}

/**
 * Update the tokenURI for an existing profile NFT (e.g., after portfolio milestones).
 * Operator-only — requires operatorWallet.
 */
export async function updateProfileMetadata(
  userId: string,
  userAddress: string,
  metadata: NftProfileMetadata,
): Promise<string | null> {
  if (!nftConfigured()) return null;

  const c = contract(operatorWallet);
  const tokenIdBig: bigint = await c.profileOf(userAddress);
  if (tokenIdBig === 0n) return null;

  let tokenUri: string;
  let rootHash: string | null = null;

  if (config.OG_STORAGE_ENABLED) {
    try {
      const metaKey = `nft-${userId}`;
      rootHash = await uploadJson(metaKey, metadata as unknown as Record<string, unknown>);
      tokenUri = `0g://${rootHash}`;
    } catch {
      tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
    }
  } else {
    tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`;
  }

  const tx = await (c.setTokenURI(tokenIdBig, tokenUri) as Promise<{ wait: () => Promise<unknown> }>);
  await tx.wait();
  console.log(`[nft] updated tokenURI for tokenId=${tokenIdBig.toString()} user=${userId}`);
  return rootHash;
}
