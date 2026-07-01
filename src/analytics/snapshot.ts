/**
 * snapshot.ts
 *
 * Local-file-based storage for daily portfolio snapshots.
 *
 * Each snapshot records a user's total portfolio value (in USD) plus a
 * per-token breakdown at a point in time. Snapshots are stored as a JSON
 * array in `.data/snapshots/<userId>.json`.
 *
 * This is intentionally a local file — not 0G Storage — because:
 *   - Snapshots are ephemeral analytics, not canonical records.
 *   - Writing to 0G Storage costs gas per upload.
 *   - The data is small and user-local, so a flat file is fast and free.
 *
 * The /history command reads from this file to show P&L over time.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PortfolioSnapshot } from '../og/portfolio';

// ── Helpers ────────────────────────────────────────────────────────────

/** ISO date string for today, e.g. "2026-07-01". */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Path to the snapshots directory relative to project root. */
function snapshotsDir(): string {
  return resolve(process.cwd(), '.data', 'snapshots');
}

/** Path to a specific user's snapshot file. */
function userPath(userId: string): string {
  return resolve(snapshotsDir(), `${userId}.json`);
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Record a portfolio snapshot for today.
 *
 * If a snapshot for today already exists, it is overwritten (only the latest
 * balance matters for the current day). Snapshots are stored as a JSON array
 * of `PortfolioSnapshot` objects, newest first.
 *
 * @returns true if the snapshot was written, false on error.
 */
export async function recordSnapshot(
  userId: string,
  totalUsd: number,
  assets: PortfolioSnapshot['assets'],
): Promise<boolean> {
  try {
    const dir = snapshotsDir();
    await fs.mkdir(dir, { recursive: true });

    const path = userPath(userId);
    let snapshots: PortfolioSnapshot[] = [];

    // Load existing snapshots
    try {
      const raw = await fs.readFile(path, 'utf8');
      snapshots = JSON.parse(raw) as PortfolioSnapshot[];
    } catch {
      // File doesn't exist yet — start fresh
    }

    // Ensure snapshots is an array
    if (!Array.isArray(snapshots)) snapshots = [];

    const date = todayISO();
    const now = Date.now();

    // Replace any existing snapshot for today (newest first in file, so
    // the first entry with matching date wins)
    const existingIdx = snapshots.findIndex((s) => s.date === date);
    const entry: PortfolioSnapshot = { date, totalUsd, assets, ts: now };

    if (existingIdx >= 0) {
      snapshots[existingIdx] = entry;
    } else {
      snapshots.push(entry);
    }

    // Sort newest first
    snapshots.sort((a, b) => b.ts - a.ts);

    await fs.writeFile(path, JSON.stringify(snapshots, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn(`[snapshot] recordSnapshot failed for user=${userId}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Retrieve portfolio snapshots for a user, optionally filtered by time range.
 *
 * @param userId Telegram user ID
 * @param sinceMs  Optional lower-bound timestamp (inclusive). Snapshots before this are excluded.
 * @returns Array of snapshots, sorted newest first.
 */
export async function getSnapshots(
  userId: string,
  sinceMs?: number,
): Promise<PortfolioSnapshot[]> {
  try {
    const raw = await fs.readFile(userPath(userId), 'utf8');
    const snapshots = JSON.parse(raw) as PortfolioSnapshot[];
    if (!Array.isArray(snapshots)) return [];

    if (sinceMs) {
      return snapshots.filter((s) => s.ts >= sinceMs).sort((a, b) => b.ts - a.ts);
    }
    return snapshots.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/**
 * Clear all snapshots for a user (useful for testing or reset).
 */
export async function clearSnapshots(userId: string): Promise<void> {
  try {
    await fs.unlink(userPath(userId));
  } catch {
    // File doesn't exist — nothing to clear
  }
}
