/**
 * In-memory mapping from a Telegram `@username` to the numeric Telegram userId
 * it was most recently seen with. Used to resolve incoming contact lookups
 * (e.g. "send to @bob") to a concrete user without forcing users to share
 * their numeric id.
 *
 * The index is process-local and intentionally non-persistent: it is rebuilt
 * lazily as users interact with the bot. On collision the latest writer wins,
 * so a username that changes hands resolves to whoever spoke most recently.
 */

interface UsernameEntry {
  userId: string;
  lastSeen: number;
}

const index = new Map<string, UsernameEntry>();

function normalize(username: string): string | null {
  const trimmed = username.trim();
  if (!trimmed) return null;
  const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  const lowered = stripped.toLowerCase();
  return lowered.length > 0 ? lowered : null;
}

/**
 * Record (or refresh) the userId currently associated with `username`.
 *
 * Null, undefined, empty, or whitespace-only usernames are ignored. A leading
 * `@` is stripped and the remainder lowercased before storage. If the username
 * already maps to a different userId the new mapping replaces the old (last
 * writer wins). `lastSeen` is set to `Date.now()` on every successful call.
 */
export function record(username: string | null | undefined, userId: string): void {
  const key = username == null ? null : normalize(username);
  if (!key) return;
  index.set(key, { userId, lastSeen: Date.now() });
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
