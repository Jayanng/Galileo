/**
 * Local index of Verified Intent Receipts — maps receiptId → metadata.
 *
 * This is a query cache (so /receipt can list a user's receipts and /verify
 * can resolve a rootHash without scanning 0G Storage). The durable artifact is
 * the receipt JSON on 0G Storage (rootHash in this index points to it).
 *
 * Persistence mirrors fileStorage.ts: a JSON file (OG_RECEIPT_INDEX_PATH)
 * loaded lazily and rewritten on every mutation. Derived beside the wallet
 * store so it lands on the same persistent volume.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';

export interface ReceiptMeta {
  receiptId: string;
  rootHash?: string;
  userId: string;
  actionType: string;
  status: string;
  createdAt: number;
  finalizedAt?: number;
}

const index = new Map<string, ReceiptMeta>();
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await fs.readFile(config.OG_RECEIPT_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ReceiptMeta>;
    for (const [k, v] of Object.entries(parsed)) index.set(k, v);
  } catch {
    console.log('[receiptStore] starting with empty receipt index');
  }
  loaded = true;
}

async function save(): Promise<void> {
  const obj: Record<string, ReceiptMeta> = {};
  for (const [k, v] of index.entries()) obj[k] = v;
  await fs.mkdir(dirname(config.OG_RECEIPT_INDEX_PATH), { recursive: true });
  await fs.writeFile(config.OG_RECEIPT_INDEX_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

export async function add(meta: ReceiptMeta): Promise<void> {
  await load();
  index.set(meta.receiptId, meta);
  await save();
}

export async function update(
  receiptId: string,
  patch: Partial<ReceiptMeta>,
): Promise<void> {
  await load();
  const cur = index.get(receiptId);
  if (!cur) return;
  index.set(receiptId, { ...cur, ...patch });
  await save();
}

export async function get(receiptId: string): Promise<ReceiptMeta | null> {
  await load();
  return index.get(receiptId) ?? null;
}

export async function getByRootHash(rootHash: string): Promise<ReceiptMeta | null> {
  await load();
  for (const m of index.values()) {
    if (m.rootHash && m.rootHash.toLowerCase() === rootHash.toLowerCase()) return m;
  }
  return null;
}

export async function listForUser(
  userId: string,
  limit: number = 10,
): Promise<ReceiptMeta[]> {
  await load();
  return Array.from(index.values())
    .filter((m) => m.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function listAll(limit: number = 50): Promise<ReceiptMeta[]> {
  await load();
  return Array.from(index.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
