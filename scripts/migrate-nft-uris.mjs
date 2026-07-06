#!/usr/bin/env node
/**
 * migrate-nft-uris.mjs
 *
 * One-time migration script that fixes all existing GalileoProfileNFT tokenURIs
 * from 0g://<rootHash> (which ChainScan cannot resolve) to data URIs (which any
 * explorer can read).
 *
 * For each token with a 0g:// URI:
 *   1. Extracts the rootHash from the URI
 *   2. Downloads the metadata from 0G Storage using the rootHash
 *   3. Builds a data:application/json;base64,... URI from the fetched metadata
 *   4. Calls setTokenURI(tokenId, dataUri) via the operator wallet
 *
 * If 0G Storage download fails, a reasonable fallback metadata object is used
 * so the NFT still shows meaningful data in explorers.
 *
 * Run:
 *   npx tsx scripts/migrate-nft-uris.mjs
 *
 * Required env vars (from .env or Fly secrets):
 *   OPERATOR_PRIVATE_KEY, OG_RPC (optional), OG_INDEXER_RPC (optional),
 *   NFT_CONTRACT_ADDRESS, OG_CHAIN_ID (optional)
 */

import 'dotenv/config';
import { JsonRpcProvider, Wallet, Contract, Network } from 'ethers';
import { Indexer } from '@0gfoundation/0g-storage-ts-sdk';

// ─── Config ────────────────────────────────────────────────────────────────

const RPC = process.env.OG_RPC || 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = process.env.OG_INDEXER_RPC || 'https://indexer-storage-testnet-turbo.0g.ai';
const CHAIN_ID = Number(process.env.OG_CHAIN_ID) || 16602;
const NFT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const PK_RAW = process.env.OPERATOR_PRIVATE_KEY;

if (!PK_RAW) {
  console.error('❌ OPERATOR_PRIVATE_KEY is required');
  process.exit(1);
}
if (!NFT_ADDRESS) {
  console.error('❌ NFT_CONTRACT_ADDRESS is required');
  process.exit(1);
}

const PK = PK_RAW.startsWith('0x') ? PK_RAW : '0x' + PK_RAW;

// ─── NFT ABI (minimal surface for reading + updating) ─────────────────────

const NFT_ABI = [
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function setTokenURI(uint256 tokenId, string uri)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildDataUri(metadata) {
  const json = JSON.stringify(metadata);
  const b64 = Buffer.from(json).toString('base64');
  return `data:application/json;base64,${b64}`;
}

function buildFallbackMetadata(tokenId, ownerAddress) {
  const shortOwner = ownerAddress.slice(0, 8) + '…' + ownerAddress.slice(-4);
  return {
    name: `Galileo Agent #${tokenId}`,
    description: `Galileo Agent Profile NFT (token #${tokenId}) on 0G Galileo. Soulbound — non-transferable identity badge.`,
    type: 'Galileo Agent Profile',
    created_at: null,
    created_at_iso: null,
    wallet_count: 1,
    chain_id: CHAIN_ID,
    attributes: [
      { trait_type: 'Token ID', value: tokenId },
      { trait_type: 'Owner', value: shortOwner },
      { trait_type: 'Chain', value: '0G Galileo Testnet' },
      { trait_type: 'Soulbound', value: 'Yes' },
    ],
  };
}

// Reusable Indexer instance for 0G Storage downloads
const _indexer = new Indexer(INDEXER_RPC);

/**
 * Download metadata from 0G Storage by rootHash using the SDK's Indexer.
 * Returns parsed JSON or null on failure.
 */
async function downloadFromStorage(rootHash) {
  try {
    const rootKey = rootHash.startsWith('0x') ? rootHash : '0x' + rootHash;
    const [blob, err] = await _indexer.downloadToBlob(rootKey, { proof: true });
    if (err || !blob) {
      console.warn(`  ⚠  downloadToBlob error: ${err || 'no blob returned'}`);
      return null;
    }
    const text = await blob.text();
    return JSON.parse(text);
  } catch (e) {
    console.warn(`  ⚠  download from 0G Storage failed: ${e.message}`);
    return null;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 GalileoProfileNFT URI Migration');
  console.log(`   RPC:       ${RPC}`);
  console.log(`   Indexer:   ${INDEXER_RPC}`);
  console.log(`   Chain ID:  ${CHAIN_ID}`);
  console.log(`   Contract:  ${NFT_ADDRESS}\n`);

  const network = new Network('0g-galileo', CHAIN_ID);
  const provider = new JsonRpcProvider(RPC, network, { staticNetwork: network });
  const wallet = new Wallet(PK, provider);
  const nft = new Contract(NFT_ADDRESS, NFT_ABI, wallet);

  // Read contract info
  const [name, symbol, totalSupply] = await Promise.all([
    nft.name(),
    nft.symbol(),
    nft.totalSupply(),
  ]);
  const total = Number(totalSupply);
  console.log(`📋 Contract: ${name} (${symbol})`);
  console.log(`   Owner:    ${wallet.address}`);
  console.log(`   Supply:   ${total} token(s)\n`);

  if (total === 0) {
    console.log('✅ No tokens to migrate.');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (let tokenId = 1; tokenId <= total; tokenId++) {
    const tokenIdBig = BigInt(tokenId);

    // Read current tokenURI
    let currentUri;
    try {
      currentUri = await nft.tokenURI(tokenIdBig);
    } catch (e) {
      console.error(`  ❌ tokenId=${tokenId}: tokenURI() failed: ${e.message}`);
      failed++;
      continue;
    }

    // Read owner for fallback metadata
    let owner = '';
    try {
      owner = await nft.ownerOf(tokenIdBig);
    } catch {
      // non-fatal — fallback metadata will show generic values
    }

    console.log(`\n📦 Token #${tokenId} (owner: ${owner ? owner.slice(0, 10) + '…' : 'unknown'})`);
    console.log(`   Current URI: ${currentUri.slice(0, 60)}${currentUri.length > 60 ? '…' : ''}`);

    // Already a data URI — skip
    if (currentUri.startsWith('data:')) {
      console.log('   ✓ Already a data URI — skipping');
      skipped++;
      continue;
    }

    // Not a 0g:// URI either — skip
    if (!currentUri.startsWith('0g://')) {
      console.log(`   ⚠  Unknown URI scheme — skipping (${currentUri.slice(0, 30)}…)`);
      skipped++;
      continue;
    }

    // Extract rootHash from 0g://<rootHash>
    const rootHash = currentUri.replace('0g://', '');
    console.log(`   🔗 0G Storage rootHash: ${rootHash.slice(0, 40)}…`);

    // Try to download metadata from 0G Storage
    let metadata = await downloadFromStorage(rootHash);
    let metadataSource;

    if (metadata && typeof metadata === 'object' && metadata.name) {
      metadataSource = '0G Storage';
      console.log(`   📥 Downloaded metadata from 0G Storage: "${metadata.name}"`);
    } else {
      // Fallback to generated metadata
      metadata = buildFallbackMetadata(tokenId, owner);
      metadataSource = 'fallback (generated)';
      console.warn(`   ⚠  Could not fetch metadata from 0G Storage — using fallback`);
    }

    // Build data URI
    const dataUri = buildDataUri(metadata);
    console.log(`   📝 New URI: ${dataUri.slice(0, 60)}…`);

    // Call setTokenURI
    try {
      const tx = await nft.setTokenURI(tokenIdBig, dataUri);
      console.log(`   ⏳ Tx submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`   ✅ Done! Block #${receipt.blockNumber}  (source: ${metadataSource})`);
      migrated++;
    } catch (e) {
      console.error(`   ❌ setTokenURI failed: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n═════════════════════════════════════`);
  console.log(`📊 Results:`);
  console.log(`   Total tokens:   ${total}`);
  console.log(`   Migrated:       ${migrated}`);
  console.log(`   Skipped:        ${skipped}`);
  console.log(`   Failed:         ${failed}`);
  console.log(`═════════════════════════════════════\n`);

  if (failed > 0) {
    console.warn('⚠️  Some migrations failed. Check the logs above for details.');
  } else if (migrated > 0) {
    console.log('🎉 All 0g:// URIs have been migrated to data URIs!');
    console.log('   ChainScan explorers will now be able to read NFT metadata.');
  } else {
    console.log('👍 No 0g:// URIs found — nothing to migrate.');
  }
}

main().catch((e) => {
  console.error('\n💥 Fatal:', e);
  process.exit(1);
});
