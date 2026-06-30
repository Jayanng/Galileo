import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import type { EncryptedBlob } from './crypto';

export interface WalletRecord {
  id: string;
  name: string;
  address: string;
  enc: EncryptedBlob;
  /** Encrypted BIP-39 seed phrase. Absent on wallets created before seed storage. */
  encMnemonic?: EncryptedBlob;
  createdAt: number;
}

export interface WalletStore {
  list(userId: string): Promise<WalletRecord[]>;
  get(userId: string, walletId: string): Promise<WalletRecord | null>;
  add(userId: string, rec: WalletRecord): Promise<void>;
  rename(userId: string, walletId: string, name: string): Promise<void>;
  remove(userId: string, walletId: string): Promise<void>;
}

export function newWalletId(): string {
  return randomBytes(4).toString('hex');
}

// The original F4 format stored a single wallet object per user (no id/name).
// Normalise any stored value into the current array shape.
function normalize(value: unknown): WalletRecord[] {
  if (Array.isArray(value)) return value as WalletRecord[];
  if (value && typeof value === 'object' && 'address' in value) {
    const old = value as Omit<WalletRecord, 'id' | 'name'>;
    return [{ id: newWalletId(), name: 'Wallet 1', ...old }];
  }
  return [];
}

/** Encrypted records on the local filesystem. Always available. */
class LocalWalletStore implements WalletStore {
  constructor(private readonly path: string) {}

  private async readAll(): Promise<Record<string, WalletRecord[]>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, WalletRecord[]> = {};
    for (const [userId, value] of Object.entries(parsed)) out[userId] = normalize(value);
    return out;
  }

  private async writeAll(all: Record<string, WalletRecord[]>): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(all, null, 2), 'utf8');
  }

  async list(userId: string): Promise<WalletRecord[]> {
    return (await this.readAll())[userId] ?? [];
  }

  async get(userId: string, walletId: string): Promise<WalletRecord | null> {
    return (await this.list(userId)).find((w) => w.id === walletId) ?? null;
  }

  async add(userId: string, rec: WalletRecord): Promise<void> {
    const all = await this.readAll();
    all[userId] = [...(all[userId] ?? []), rec];
    await this.writeAll(all);
  }

  async rename(userId: string, walletId: string, name: string): Promise<void> {
    const all = await this.readAll();
    const wallets = all[userId] ?? [];
    const wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) return;
    wallet.name = name;
    all[userId] = wallets;
    await this.writeAll(all);
  }

  async remove(userId: string, walletId: string): Promise<void> {
    const all = await this.readAll();
    const wallets = (all[userId] ?? []).filter((w) => w.id !== walletId);
    all[userId] = wallets;
    await this.writeAll(all);
  }
}

/**
 * Persists each user's wallet list to 0G Storage KV, mirrored locally for fast/durable
 * reads. 0G calls are best-effort: on failure we keep working from the local mirror.
 */
class OgKvWalletStore implements WalletStore {
  constructor(private readonly local: LocalWalletStore) {}

  private kvKey(userId: string): string {
    return `wallet:${userId}`;
  }

  private async pullIfEmpty(userId: string): Promise<void> {
    if ((await this.local.list(userId)).length) return;
    try {
      const { getKV } = await import('../og/storage');
      const bytes = await getKV(this.kvKey(userId));
      if (!bytes) return;
      for (const rec of normalize(JSON.parse(Buffer.from(bytes).toString('utf8')))) {
        await this.local.add(userId, rec);
      }
    } catch (e) {
      console.warn('[storage] 0G KV read failed, using local store only:', (e as Error).message);
    }
  }

  private async push(userId: string): Promise<void> {
    try {
      const { putKV } = await import('../og/storage');
      const bytes = new TextEncoder().encode(JSON.stringify(await this.local.list(userId)));
      const { rootHash } = await putKV(this.kvKey(userId), bytes);
      console.log(`[storage] wallet:${userId} persisted to 0G Storage (root ${rootHash}).`);
    } catch (e) {
      console.warn('[storage] 0G KV write failed, kept local copy only:', (e as Error).message);
    }
  }

  async list(userId: string): Promise<WalletRecord[]> {
    await this.pullIfEmpty(userId);
    return this.local.list(userId);
  }

  async get(userId: string, walletId: string): Promise<WalletRecord | null> {
    await this.pullIfEmpty(userId);
    return this.local.get(userId, walletId);
  }

  async add(userId: string, rec: WalletRecord): Promise<void> {
    await this.local.add(userId, rec);
    await this.push(userId);
  }

  async rename(userId: string, walletId: string, name: string): Promise<void> {
    await this.local.rename(userId, walletId, name);
    await this.push(userId);
  }

  async remove(userId: string, walletId: string): Promise<void> {
    await this.local.remove(userId, walletId);
    await this.push(userId);
  }
}

export function createWalletStore(): WalletStore {
  const local = new LocalWalletStore(config.WALLET_STORE_PATH);
  return config.OG_STORAGE_ENABLED ? new OgKvWalletStore(local) : local;
}

export const walletStore = createWalletStore();
