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
