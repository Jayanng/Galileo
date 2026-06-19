import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';
import type { EncryptedBlob } from './crypto';

export interface WalletRecord {
  address: string;
  enc: EncryptedBlob;
  createdAt: number;
}

export interface WalletStore {
  load(userId: string): Promise<WalletRecord | null>;
  save(userId: string, rec: WalletRecord): Promise<void>;
}

/** Encrypted records on the local filesystem. Always available. */
class LocalWalletStore implements WalletStore {
  constructor(private readonly path: string) {}

  private async readAll(): Promise<Record<string, WalletRecord>> {
    try {
      return JSON.parse(await fs.readFile(this.path, 'utf8')) as Record<string, WalletRecord>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }

  async load(userId: string): Promise<WalletRecord | null> {
    return (await this.readAll())[userId] ?? null;
  }

  async save(userId: string, rec: WalletRecord): Promise<void> {
    const all = await this.readAll();
    all[userId] = rec;
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(all, null, 2), 'utf8');
  }
}

/**
 * Persists records to 0G Storage KV, mirrored locally for fast/durable reads.
 * 0G writes/reads are best-effort: if the network call fails we keep working
 * from the local mirror rather than failing the user's request.
 */
class OgKvWalletStore implements WalletStore {
  constructor(private readonly local: LocalWalletStore) {}

  private kvKey(userId: string): string {
    return `wallet:${userId}`;
  }

  async load(userId: string): Promise<WalletRecord | null> {
    const cached = await this.local.load(userId);
    if (cached) return cached;
    try {
      const { getKV } = await import('../og/storage');
      const bytes = await getKV(this.kvKey(userId));
      if (!bytes) return null;
      const rec = JSON.parse(Buffer.from(bytes).toString('utf8')) as WalletRecord;
      await this.local.save(userId, rec); // refresh the mirror
      return rec;
    } catch (e) {
      console.warn('[storage] 0G KV read failed, using local store only:', (e as Error).message);
      return null;
    }
  }

  async save(userId: string, rec: WalletRecord): Promise<void> {
    await this.local.save(userId, rec); // durable locally first
    try {
      const { putKV } = await import('../og/storage');
      const bytes = new TextEncoder().encode(JSON.stringify(rec));
      const { rootHash } = await putKV(this.kvKey(userId), bytes);
      console.log(`[storage] wallet:${userId} persisted to 0G Storage (root ${rootHash}).`);
    } catch (e) {
      console.warn('[storage] 0G KV write failed, kept local copy only:', (e as Error).message);
    }
  }
}

export function createWalletStore(): WalletStore {
  const local = new LocalWalletStore(config.WALLET_STORE_PATH);
  return config.OG_STORAGE_ENABLED ? new OgKvWalletStore(local) : local;
}

export const walletStore = createWalletStore();
