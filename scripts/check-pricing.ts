import 'dotenv/config';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import { operatorWallet } from '../src/og/chain';

async function main(): Promise<void> {
  const broker = await createZGComputeNetworkBroker(operatorWallet);
  const services = (await broker.inference.listService(0, 50, false)) as Array<{
    provider: string;
    serviceType: string;
    model: string;
    verifiability: string;
    inputPrice: bigint;
    outputPrice: bigint;
    teeSignerAcknowledged: boolean;
  }>;

  console.log(`Found ${services.length} service(s):\n`);
  for (const s of services) {
    console.log(`  provider:      ${s.provider}`);
    console.log(`  serviceType:   ${s.serviceType}`);
    console.log(`  model:         ${s.model}`);
    console.log(`  verifiability: ${s.verifiability}`);
    console.log(
      `  inputPrice:    ${s.inputPrice.toString()} neuron (= ${Number(s.inputPrice) / 1e18} OG per 1k tokens)`,
    );
    console.log(
      `  outputPrice:   ${s.outputPrice.toString()} neuron (= ${Number(s.outputPrice) / 1e18} OG per 1k tokens)`,
    );
    console.log(`  TEE signer OK: ${s.teeSignerAcknowledged}`);
    console.log('');
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
