/**
 * compare-addresses.ts
 *
 * One-off debug helper: compares a 0G ChainScan explorer URL's address against
 * the operator wallet derived from `OPERATOR_PRIVATE_KEY`. Useful when a tx
 * doesn't appear under the expected wallet on the explorer and you want to
 * rule out a checksum/casing mismatch or a different EOA.
 *
 * Usage:
 *   1. Paste the address from the explorer URL into `URL_ADDRESS` below.
 *   2. Ensure OPERATOR_PRIVATE_KEY is set (or in .env) for the wallet you
 *      expect to be looking at.
 *   3. Run: npx tsx scripts/compare-addresses.ts
 *
 * The script canonicalizes both addresses (ethers.getAddress) and reports
 * whether they refer to the same underlying EOA or different ones.
 *
 * This is a debugging tool, not part of the runtime bot.
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { operatorWallet } from '../src/og/chain';

const URL_ADDRESS = '0xcab9a7cf9c42307fad1140c378ea9a9eddcbfc07';
const BOT_ADDRESS = operatorWallet.address;

async function main(): Promise<void> {
  console.log(`Bot address (from OPERATOR_PRIVATE_KEY): ${BOT_ADDRESS}`);
  console.log(`URL address (from your explorer link):  ${URL_ADDRESS}`);
  console.log();

  let urlCanonical: string;
  try {
    urlCanonical = ethers.getAddress(URL_ADDRESS);
    console.log(`URL address canonicalized: ${urlCanonical}`);
  } catch (e) {
    console.log(`URL address has invalid checksum: ${(e as Error).message}`);
    try {
      urlCanonical = ethers.getAddress(URL_ADDRESS.toLowerCase());
      console.log(`URL address (forced lower) canonicalized: ${urlCanonical}`);
    } catch (e2) {
      console.log(`URL address is not a valid address at all: ${(e2 as Error).message}`);
      return;
    }
  }

  console.log();
  if (urlCanonical.toLowerCase() === BOT_ADDRESS.toLowerCase()) {
    console.log('OK: same underlying address (just different casing/checksum).');
  } else {
    console.log('DIFFERENT ADDRESSES — bot and explorer are looking at different EOAs!');
    console.log(`  Bot:  ${BOT_ADDRESS}`);
    console.log(`  URL:  ${urlCanonical}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
