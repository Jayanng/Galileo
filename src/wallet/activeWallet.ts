import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config';

/**
 * Tracks each user's currently-selected ("active") wallet, persisted next to the
 * wallet store (e.g. .data/active.json). The active wallet drives the home
 * dashboard: its balance is shown, Deposit reveals its address, and Settings →
 * Export reveals its private key.
 */

function activePath(): string {
  return join(dirname(config.WALLET_STORE_PATH), 'active.json');
}

async function readAll(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(activePath(), 'utf8')) as Record<string, string>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
}

export async function getActiveId(userId: string): Promise<string | null> {
  return (await readAll())[userId] ?? null;
}

export async function setActiveId(userId: string, walletId: string): Promise<void> {
  const all = await readAll();
  all[userId] = walletId;
  await fs.mkdir(dirname(activePath()), { recursive: true });
  await fs.writeFile(activePath(), JSON.stringify(all, null, 2), 'utf8');
}
