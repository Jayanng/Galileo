/**
 * Intent persistence for the Scheduled Intents Engine.
 *
 * Same pattern as src/wallet/walletStore.ts:
 *   - LocalStore (always on): reads/writes a flat array at INTENTS_STORE_PATH.
 *   - OgFileStore (when OG_STORAGE_ENABLED=true): mirrors to 0G Storage under
 *     the global namespace 'intents:global'. Read-pulls on first miss.
 *
 * DCA + Alert intents live side-by-side. They share one namespace because the
 * worker needs to scan across all users on every tick.
 */
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { IntentSchema, type Intent } from './types';

const DEFAULT_PATH = '.data/intents.json';

/** Resolved at construction time so we never read process.env at call sites. */
const STORE_PATH = process.env.INTENTS_STORE_PATH || join(dirname(config.WALLET_STORE_PATH), 'intents.json');
const OG_NAMESPACE = 'intents:global';

export function newIntentId(): string {
  return randomBytes(4).toString('hex');
}

function coerce(value: unknown): Intent[] {
  if (!Array.isArray(value)) return [];
  const out: Intent[] = [];
  for (const raw of value) {
    const parsed = IntentSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
    else console.warn('[intents] dropping malformed record on load:', parsed.error.issues);
  }
  return out;
}

export interface IntentStore {
  listAll(): Promise<Intent[]>;
  listForUser(userId: string): Promise<Intent[]>;
  get(id: string): Promise<Intent | null>;
  add(intent: Intent): Promise<void>;
  update(id: string, patch: Partial<Intent>): Promise<Intent | null>;
  remove(id: string): Promise<boolean>;
}

// ── Local store ─────────────────────────────────────────────────────────

class LocalIntentStore implements IntentStore {
  constructor(private readonly path: string) {}

  private async readAll(): Promise<Intent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return coerce(JSON.parse(raw));
  }

  private async writeAll(list: Intent[]): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(list, null, 2), 'utf8');
  }

  async listAll(): Promise<Intent[]> {
    return this.readAll();
  }
  async listForUser(userId: string): Promise<Intent[]> {
    return (await this.readAll()).filter((i) => i.userId === userId);
  }
  async get(id: string): Promise<Intent | null> {
    return (await this.readAll()).find((i) => i.id === id) ?? null;
  }
  async add(intent: Intent): Promise<void> {
    const list = await this.readAll();
    list.push(intent);
    await this.writeAll(list);
  }
  async update(id: string, patch: Partial<Intent>): Promise<Intent | null> {
    const list = await this.readAll();
    const idx = list.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const merged = { ...list[idx]!, ...patch, id } as Intent;
    const parsed = IntentSchema.safeParse(merged);
    if (!parsed.success) {
      console.warn('[intents] update produced invalid record:', parsed.error.issues);
      return null;
    }
    list[idx] = parsed.data;
    await this.writeAll(list);
    return parsed.data;
  }
  async remove(id: string): Promise<boolean> {
    const list = await this.readAll();
    const next = list.filter((i) => i.id !== id);
    if (next.length === list.length) return false;
    await this.writeAll(next);
    return true;
  }
}

// ── 0G Storage mirror ───────────────────────────────────────────────────

class OgFileIntentStore implements IntentStore {
  private loaded = false;
  constructor(private readonly local: LocalIntentStore) {}

  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    try {
      const { downloadJson } = await import('../og/fileStorage');
      const remote = await downloadJson<unknown>(OG_NAMESPACE);
      if (Array.isArray(remote) && remote.length > 0) {
        const local = await this.local.listAll();
        if (local.length === 0) {
          const recovered = coerce(remote);
          for (const intent of recovered) await this.local.add(intent);
          if (recovered.length > 0) {
            console.log(`[intents] hydrated ${recovered.length} intent(s) from 0G Storage after cold start`);
          }
        }
      } else {
        console.log('[intents] no intents found on 0G Storage to hydrate (fresh start or empty store)');
      }
    } catch (e) {
      console.warn('[intents] 0G Storage hydrate failed:', (e as Error).message);
    }
    this.loaded = true;
  }

  private async push(): Promise<void> {
    try {
      const { uploadJson } = await import('../og/fileStorage');
      const list = await this.local.listAll();
      const root = await uploadJson(OG_NAMESPACE, list);
      console.log(`[intents] persisted ${list.length} intents to 0G Storage (root ${root}).`);
    } catch (e) {
      console.warn('[intents] 0G Storage push failed, kept local copy only:', (e as Error).message);
    }
  }

  async listAll(): Promise<Intent[]> {
    await this.hydrate();
    return this.local.listAll();
  }
  async listForUser(userId: string): Promise<Intent[]> {
    await this.hydrate();
    return this.local.listForUser(userId);
  }
  async get(id: string): Promise<Intent | null> {
    await this.hydrate();
    return this.local.get(id);
  }
  async add(intent: Intent): Promise<void> {
    await this.local.add(intent);
    await this.push();
  }
  async update(id: string, patch: Partial<Intent>): Promise<Intent | null> {
    const updated = await this.local.update(id, patch);
    if (updated) await this.push();
    return updated;
  }
  async remove(id: string): Promise<boolean> {
    const ok = await this.local.remove(id);
    if (ok) await this.push();
    return ok;
  }
}

export function createIntentStore(opts?: { forceLocal?: boolean }): IntentStore {
  const local = new LocalIntentStore(STORE_PATH || DEFAULT_PATH);
  if (opts?.forceLocal || !config.OG_STORAGE_ENABLED) return local;
  return new OgFileIntentStore(local);
}

export const intentStore = createIntentStore();
export { LocalIntentStore };
