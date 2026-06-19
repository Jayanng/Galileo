import {
  Indexer,
  KvClient,
  Batcher,
  FixedPriceFlow__factory,
} from '@0gfoundation/0g-storage-ts-sdk';
import { config } from '../config';
import { operatorWallet } from './chain';

/**
 * Thin wrapper around 0G Storage key-value operations.
 *
 * Writes go through a Batcher (selects storage nodes, builds a stream-data
 * payload, and submits via the FixedPriceFlow contract). Reads use the KV
 * client's getValue. This module is only imported when OG_STORAGE_ENABLED is
 * true, so the 0G SDK and its network calls stay out of the default path.
 */

const enc = new TextEncoder();
const keyBytes = (key: string): Uint8Array => enc.encode(key);

let kvClient: KvClient | null = null;
function getKvClient(): KvClient {
  if (!kvClient) kvClient = new KvClient(config.OG_KV_RPC);
  return kvClient;
}

export async function putKV(
  key: string,
  value: Uint8Array,
): Promise<{ txHash: string; rootHash: string }> {
  const indexer = new Indexer(config.OG_INDEXER_RPC);
  const [nodes, err] = await indexer.selectNodes(1);
  if (err || !nodes || nodes.length === 0) {
    throw new Error(`0G selectNodes failed: ${err ? String(err) : 'no storage nodes available'}`);
  }

  // FixedPriceFlow factory typing targets a slightly different Signer shape;
  // the operator wallet satisfies it at runtime.
  const flow = FixedPriceFlow__factory.connect(
    config.OG_FLOW_CONTRACT,
    operatorWallet as unknown as Parameters<typeof FixedPriceFlow__factory.connect>[1],
  );

  const batcher = new Batcher(1, nodes, flow, config.OG_RPC);
  batcher.streamDataBuilder.set(config.OG_STREAM_ID, keyBytes(key), value);
  const [res, execErr] = await batcher.exec();
  if (execErr) throw execErr;
  return res;
}

export async function getKV(key: string): Promise<Uint8Array | null> {
  const value = await getKvClient().getValue(config.OG_STREAM_ID, keyBytes(key));
  if (!value || !value.data) return null;
  // value.data is base64-encoded.
  return new Uint8Array(Buffer.from(value.data, 'base64'));
}
