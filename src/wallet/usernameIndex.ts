/**
 * In-memory mapping from a Telegram `@username` to the numeric Telegram userId
 * it was most recently seen with. Used to resolve incoming contact lookups
 * (e.g. "send to @bob") to a concrete user without forcing users to share
 * their numeric id.
 *
 * The index is process-local. It is rebuilt lazily as users interact with
 * the bot (every incoming message re-records the handle). When 0G Storage
 * is enabled (OG_STORAGE_ENABLED=true), the index is also persisted across
 * restarts: hydrate() populates the Map from 0G Storage at startup, and
 * every record() call fires a non-blocking persist(). The in-memory Map is
 * always the source of truth at runtime — persistence is purely additive
 * and gated by config so the default behavior is unchanged.
 *
 * On collision the latest writer wins, so a username that changes hands
 * resolves to whoever spoke most recently.
 */

import { uploadJson, downloadJson } from '../og/fileStorage';
import { config } from '../config';

interface UsernameEntry {
  userId: string;
  lastSeen: number;
}

const index = new Map<string, UsernameEntry>();

/** Fixed key under which the username registry is stored on 0G Storage. */
const STORAGE_KEY = '__username_index__';

function normalize(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed) return null;
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const lowered = stripped.toLowerCase();
  return lowered.length > 0 ? lowered : null;
}

/**
 * Fire-and-forget upload of the current index state to 0G Storage.
 *
 * No-op when OG_STORAGE_ENABLED=false (the default). Never throws — failures
 * are logged so the in-memory Map remains the runtime source of truth.
 */
async function persist(): Promise<void> {
  if (!config.OG_STORAGE_ENABLED) return;
  try {
    const snapshot = Object.fromEntries(index);
    await uploadJson(STORAGE_KEY, snapshot);
  } catch (e) {
    console.warn(`[usernameIndex] persist failed: ${(e as Error).message}`);
  }
}

/**
 * Record (or refresh) the userId currently associated with `username`.
 *
 * Null, undefined, empty, or whitespace-only usernames are ignored. A leading
 * `@` is stripped and the remainder lowercased before storage. If the username
 * already maps to a different userId the new mapping replaces the old (last
 * writer wins). `lastSeen` is set to `Date.now()` on every successful call.
 *
 * When OG_STORAGE_ENABLED=true, also fires a non-blocking persist() to
 * 0G Storage. The in-memory Map update is synchronous and the upload runs
 * on the event loop — callers see no change in timing.
 */
export function record(username: string | null | undefined, userId: string): void {
  const key = username == null ? null : normalize(username);
  if (!key) return;
  index.set(key, { userId, lastSeen: Date.now() });
  void persist();
}

/**
 * Resolve a username to its currently associated userId.
 *
 * The input is normalised the same way as {@link record}: trimmed, stripped of
 * a leading `@`, and lowercased. Returns `null` when the username is not in
 * the index or the input normalises to an empty string.
 */
export function lookup(username: string): string | null {
  const key = normalize(username);
  if (!key) return null;
  return index.get(key)?.userId ?? null;
}

/** Number of distinct usernames currently held in the index. */
export function count(): number {
  return index.size;
}

/** Drop every entry from the index. Intended for tests and clean shutdowns. */
export function clear(): void {
  index.clear();
}

/**
 * Populate the in-memory index from 0G Storage. Call once at bot startup
 * (after `buildBot()` and before `bot.start()`) so `/send @handle` resolves
 * immediately after restart, before the recipient has sent a new message.
 *
 * No-op when OG_STORAGE_ENABLED=false. If the download fails, the index
 * stays empty and rebuilds from message traffic as it does today.
 */
export async function hydrate(): Promise<void> {
  if (!config.OG_STORAGE_ENABLED) return;
  try {
    const data = await downloadJson<Record<string, UsernameEntry>>(STORAGE_KEY);
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        index.set(k, v);
      }
      console.log(`[usernameIndex] hydrated ${index.size} entries from 0G Storage`);
    }
  } catch (e) {
    console.warn(`[usernameIndex] hydrate failed: ${(e as Error).message}`);
  }
}
