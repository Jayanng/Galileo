/**
 * Import-wallet feature: bring an existing 0G wallet into the user's set via
 * its private key. No seed phrase, no JSON keystore, no Ledger — private key
 * only (per feature spec).
 *
 * This file owns every piece of the import flow:
 *   1. Per-user state map ("awaiting key" → "awaiting confirm")
 *   2. Pure validation of raw key strings (regex + ethers address derivation)
 *   3. Service that stores a validated key in walletStore
 *
 * The Telegram UI lives in src/handlers/importHandlers.ts. bot.ts adds one
 * command, one interceptor, and two callbackQuery handlers pointing at it.
 *
 * Threat model: the validated raw key sits in process memory for at most
 * PREVIEW_TTL_MS between the user sending it and tapping Confirm. After that
 * it is overwritten by a fresh stage or process restart. The key is never
 * written to disk at this stage — it only becomes a record after the user
 * explicitly confirms, at which point it's encrypted with AES-256-GCM and
 * written to the wallet store (same path as /wallet-created keys).
 */

import { Wallet } from 'ethers';
import { encrypt } from './crypto';
import { walletStore, newWalletId, type WalletRecord } from './walletStore';
import { listWallets, type WalletInfo } from './walletService';
import { config } from '../config';

// ── State ───────────────────────────────────────────────────────────────

interface PendingImport {
  /** Set once the user has sent a valid key and we're showing the preview. */
  preview?: {
    /** Canonical 0x-prefixed private key, validated. Held in memory only until confirm. */
    privateKey: string;
    /** Derived EVM address shown in the preview, used for the duplicate check. */
    address: string;
    /** Unix-ms. After this, the preview is discarded even if user taps Confirm. */
    expiresAt: number;
  };
}

const pending = new Map<string, PendingImport>();

/** Max age of an in-memory preview between key input and Confirm/Cancel. */
const PREVIEW_TTL_MS = 5 * 60 * 1000;

export const importState = {
  /** Mark a user as waiting for a private-key message (no preview yet). */
  stage(userId: string): void {
    pending.set(userId, {});
  },
  /** Promote a user from "waiting for key" to "showing preview". */
  setPreview(userId: string, data: { privateKey: string; address: string }): void {
    pending.set(userId, {
      preview: { ...data, expiresAt: Date.now() + PREVIEW_TTL_MS },
    });
  },
  /** Read the current preview (with expiry); undefined if none or expired. */
  getPreview(userId: string): { privateKey: string; address: string; expiresAt: number } | undefined {
    const p = pending.get(userId)?.preview;
    if (!p) return undefined;
    if (p.expiresAt < Date.now()) {
      pending.delete(userId);
      return undefined;
    }
    return p;
  },
  /** True if a stage or a preview is open for this user. */
  isActive(userId: string): boolean {
    return pending.has(userId);
  },
  /** Drop any state for this user (called on Cancel / confirm / expiry / new command). */
  clear(userId: string): void {
    pending.delete(userId);
  },
};

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Normalize raw input to canonical 0x-prefixed 64-hex form. Pure string check,
 * not yet validated against secp256k1 — call inspectPrivateKey for that.
 * Returns null on any failure.
 */
function normalizePrivateKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  // Reject the all-zeros key (a common sentinel / not a real key).
  if (/^0x0{64}$/i.test(withPrefix)) return null;
  return withPrefix;
}

/**
 * Validate raw input and return the canonical key + derived address.
 *
 * - Accepts with or without 0x prefix.
 * - Requires exactly 64 hex chars.
 * - Rejects the all-zeros sentinel.
 * - Confirms the key actually derives a valid secp256k1 address via ethers.
 */
export function inspectPrivateKey(
  raw: string,
): { ok: true; privateKey: string; address: string } | { ok: false; error: string } {
  const privateKey = normalizePrivateKey(raw);
  if (!privateKey) {
    return {
      ok: false,
      error:
        "That doesn't look like a valid private key. " +
        'Expected a 64-character hex string, with or without the `0x` prefix.',
    };
  }
  let address: string;
  try {
    address = new Wallet(privateKey).address;
  } catch (e) {
    return {
      ok: false,
      error: `Could not derive an address from that key: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, privateKey, address };
}

// ── Service ────────────────────────────────────────────────────────────

export interface ImportOk {
  ok: true;
  wallet: WalletInfo;
}
export interface ImportErr {
  ok: false;
  error: string;
  /** Useful for debugging / telling the user which address collided. */
  address?: string;
}

/**
 * Import a wallet using a previously-validated private key + its derived address.
 *
 * - Refuses to add a wallet whose address already exists in the user's set
 *   (no silent overwrites; tell the user which wallet it conflicts with).
 * - Imported wallets do NOT have a seed phrase — `encMnemonic` is intentionally
 *   omitted so the `/privatekey` flow reports "no recovery phrase stored" later.
 *   (Imported keys never carry a mnemonic in the first place.)
 * - No gas drip: the user is bringing their own wallet, assumed already funded.
 */
export async function importWallet(
  userId: string,
  privateKey: string,
  address: string,
): Promise<ImportOk | ImportErr> {
  const existing = await listWallets(userId);
  const dup = existing.find((w) => w.address.toLowerCase() === address.toLowerCase());
  if (dup) {
    return {
      ok: false,
      error:
        `You already have a wallet with that address (named "${dup.name}"). ` +
        `Importing would create a duplicate. Use /rename or /wallet to manage your existing wallets instead.`,
      address,
    };
  }

  const rec: WalletRecord = {
    id: newWalletId(),
    name: `Imported ${existing.length + 1}`,
    address,
    enc: encrypt(privateKey, config.WALLET_ENCRYPTION_KEY),
    // Note: encMnemonic deliberately absent — private key import has no seed phrase.
    createdAt: Date.now(),
  };
  await walletStore.add(userId, rec);

  console.log(`[import] user=${userId} imported wallet=${rec.name} ${address}`);
  return {
    ok: true,
    wallet: { id: rec.id, name: rec.name, address: rec.address, createdAt: rec.createdAt },
  };
}
