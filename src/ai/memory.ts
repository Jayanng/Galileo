/**
 * F1: Infinite Wallet Memory (File Mode).
 *
 * Every user message, assistant reply, and tool call is persisted to 0G Storage
 * as a single rolling snapshot file per user. The AI agent can retrieve any past
 * interaction via the `search_history` tool, enabling questions like "what did I
 * do yesterday?"
 *
 * Architecture: One rolling snapshot per user on 0G Storage (via fileStorage.ts).
 *   - Each write uploads the full history as a new snapshot.
 *   - A local index file (OG_STORAGE_INDEX_PATH) maps userId → latest rootHash.
 *   - If the index is lost, the data is still on 0G (just harder to find).
 *
 * Memory is best-effort: if 0G Storage is unavailable OR returns a malformed
 * snapshot (e.g. a stale payload from a previous bot version), we log a
 * warning and continue. The snapshot shape is validated by `coerceSnapshot`
 * inside `loadHistory`, so every `cache.set` only ever holds a
 * HistorySnapshot with a real array `entries`. Consequently the four record*
 * functions cannot throw on a malformed-snapshot regression — the persistent
 * upload to 0G Storage remains fire-and-forget. The bot must never crash
 * due to a memory failure.
 */

import { config } from '../config';
import { uploadJson, downloadJson, clearIndex } from '../og/fileStorage';

// ───────────────────────────────────────────────────────────────────────
// TYPES (preserved — other files import these)
// ───────────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export interface StoredMessage {
  role: MessageRole;
  content: string;
  ts: number;
}

export interface StoredToolCall {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ts: number;
}

export interface StoredTx {
  type: 'send' | 'receive' | 'create' | 'swap';
  amount?: string;
  to?: string;
  from?: string;
  hash: string;
  ts: number;
}

/**
 * Cryptographic proof that an AI reply was generated inside a TEE.
 * `verified === true` means the provider's TEE signer signed the response
 * and the signature checked out; `false` means it was signed but failed
 * verification; `null` means verification was not attempted (e.g. fallback
 * mode or `processResponse` threw).
 */
export interface StoredProof {
  chatID: string;
  providerAddress: string;
  verified: boolean | null;
  ts: number;
}

export type MemoryEntry =
  | { kind: 'msg'; data: StoredMessage }
  | { kind: 'tool'; data: StoredToolCall }
  | { kind: 'tx'; data: StoredTx }
  | { kind: 'proof'; data: StoredProof };

/** Search result type: flattened entry with a `kind` discriminator. */
export type SearchEntry = (StoredMessage | StoredToolCall | StoredTx | StoredProof) & {
  kind: 'msg' | 'tool' | 'tx' | 'proof';
};

// ───────────────────────────────────────────────────────────────────────
// Internal: Snapshot structure stored on 0G
// ───────────────────────────────────────────────────────────────────────

/**
 * A user's history snapshot. The only invariant `coerceSnapshot` enforces
 * is that `entries` is an actual `MemoryEntry[]` — every field inside each
 * `MemoryEntry` is treated as a trusted runtime value (not schema-validated
 * on read; the memory is an opaque log, the LLM never consumes it directly).
 *
 * Internal-only; not exported (callers interact via the public record* API).
 */
interface HistorySnapshot {
  entries: MemoryEntry[];
}

/**
 * Coerce an arbitrary value (typically the parsed JSON of a 0G Storage
 * snapshot) into a HistorySnapshot with a guaranteed-array `entries`.
 *
 * Why: a production incident in `recordToolCall` threw
 *   `TypeError: history.entries.push is not a function`
 * because a 0G Storage snapshot for one user was shaped differently
 * (likely a previous bot version wrote `entries` as a Map, a plain object,
 * undefined, etc.). Without this guard, every subsequent read of that
 * snapshot re-explodes with the same TypeError until something manually
 * purges the cache. With this guard, the bad snapshot is normalised to an
 * empty array and the next write heals the user's memory on 0G (the new
 * valid snapshot overwrites the stale rootHash in the local index).
 *
 * Behaviour:
 *   - Valid input (object with array `entries`) → returned by reference,
 *     preserving the cache-internal `cached === cached` invariant.
 *   - Anything else → logs a single `[memory]` warning and returns a fresh
 *     `{ entries: [] }`. `coerceSnapshot` never throws.
 *
 * Exported so it can be exercised by a unit test without touching 0G.
 */
export function coerceSnapshot(raw: unknown, userId: string): HistorySnapshot {
  if (
    raw != null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { entries?: unknown }).entries)
  ) {
    return raw as HistorySnapshot;
  }
  console.warn(
    `[memory] user=${userId}: snapshot on 0G had invalid shape — ${describe(raw)}; resetting to empty history. ` +
      `Usually a stale snapshot from a previous bot version. The next write will re-seed a valid snapshot on 0G.`,
  );
  return { entries: [] };
}

function describe(raw: unknown): string {
  if (raw === null) return 'null';
  if (raw === undefined) return 'undefined';
  if (Array.isArray(raw)) return 'an array (missing the { entries: [...] } wrapper)';
  if (typeof raw !== 'object') return `got a ${typeof raw}`;
  const entries = (raw as { entries?: unknown }).entries;
  if (entries === undefined) return "object missing the `.entries` field";
  return `object with \`.entries\` = ${describeValue(entries)}`;
}

function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  return typeof v;
}

// In-memory cache
const cache = new Map<string, HistorySnapshot>();
const loadingPromises = new Map<string, Promise<HistorySnapshot>>();

function memoryEnabled(): boolean {
  return config.OG_MEMORY_ENABLED;
}

/**
 * Load a user's history (cache first, then 0G Storage).
 * Deduplicates concurrent loads for the same user.
 */
async function loadHistory(userId: string): Promise<HistorySnapshot> {
  if (!memoryEnabled()) return { entries: [] };

  // 1. Return if cached
  const cached = cache.get(userId);
  if (cached) return cached;

  // 2. Dedup concurrent loads
  const pending = loadingPromises.get(userId);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const data = await downloadJson<HistorySnapshot>(userId);
      // coerceSnapshot guarantees `entries` is an array, even if 0G returns
      // a stale/malformed payload from a previous bot version (see comment
      // on coerceSnapshot for the production history of this guard).
      const snapshot = coerceSnapshot(data, userId);
      cache.set(userId, snapshot);
      return snapshot;
    } catch (e) {
      console.warn(`[memory] loadHistory failed for user=${userId}:`, (e as Error).message);
      return { entries: [] };
    }
  })();

  loadingPromises.set(userId, promise);
  try {
    return await promise;
  } finally {
    loadingPromises.delete(userId);
  }
}

/**
 * Maximum number of entries to keep per user.
 * When exceeded, the oldest entries are pruned before upload.
 * Set to 0 to disable compaction.
 */
const MAX_ENTRIES = config.OG_MEMORY_MAX_ENTRIES;

/**
 * Compact a user's history by pruning the oldest entries.
 * Keeps the most recent MAX_ENTRIES entries (FIFO).
 * Logs if compaction actually prunes anything.
 */
function compact(userId: string, history: HistorySnapshot): void {
  if (MAX_ENTRIES <= 0) return;
  const before = history.entries.length;
  if (before <= MAX_ENTRIES) return;
  const removed = before - MAX_ENTRIES;
  history.entries = history.entries.slice(-MAX_ENTRIES);
  console.log(`[memory] compacted user=${userId}: pruned ${removed} entries (${before} → ${MAX_ENTRIES})`);
}

/**
 * Save history back to 0G Storage (best-effort, debounced).
 *
 * Instead of uploading on every record* call (4-5 per user turn), we debounce:
 * wait OG_MEMORY_UPLOAD_DEBOUNCE_MS after the last write, then upload once.
 * If writes keep coming, force-flush after OG_MEMORY_UPLOAD_MAX_WAIT_MS so a
 * snapshot eventually persists. This collapses a 5-upload burst into 1,
 * cutting 0G Storage queue depth and per-upload gas cost dramatically.
 *
 * Only memory snapshots are debounced. F5 receipts (receiptService.ts) call
 * fileStorage.uploadJson directly and remain immediate — their rootHash is
 * surfaced to the user and must be available ASAP.
 *
 * The in-memory cache is updated synchronously (in scheduleUpload), so
 * subsequent reads (getRecent / search / getRecentProofs) see the new entry
 * immediately — the debounce only delays the 0G Storage persistence, not
 * what the LLM sees on the next turn.
 */
const DEBOUNCE_MS = config.OG_MEMORY_UPLOAD_DEBOUNCE_MS;
const MAX_WAIT_MS = config.OG_MEMORY_UPLOAD_MAX_WAIT_MS;

interface PendingUpload {
  history: HistorySnapshot;
  timer: NodeJS.Timeout;
  firstScheduledAt: number;
}
const pendingUploads = new Map<string, PendingUpload>();

function scheduleUpload(userId: string, history: HistorySnapshot): void {
  if (!memoryEnabled()) return;
  cache.set(userId, history);

  const existing = pendingUploads.get(userId);
  const now = Date.now();

  if (existing) {
    // Already a pending upload for this user — just refresh the reference and
    // reset the debounce timer. Force-flush immediately if we've been waiting
    // too long (caps worst-case data loss during sustained activity).
    existing.history = history;
    clearTimeout(existing.timer);
    const elapsed = now - existing.firstScheduledAt;
    const delay = elapsed >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
    existing.timer = setTimeout(() => { void flushUpload(userId); }, delay);
    return;
  }

  // First write in a burst — schedule a new debounced upload.
  const entry: PendingUpload = {
    history,
    timer: setTimeout(() => { void flushUpload(userId); }, DEBOUNCE_MS),
    firstScheduledAt: now,
  };
  pendingUploads.set(userId, entry);
}

async function flushUpload(userId: string): Promise<void> {
  const entry = pendingUploads.get(userId);
  if (!entry) return;
  pendingUploads.delete(userId);
  try {
    compact(userId, entry.history);
    await uploadJson(userId, entry.history);
  } catch (e) {
    console.warn(`[memory] debounced upload failed for user=${userId}:`, (e as Error).message);
  }
}

async function saveHistory(userId: string, history: HistorySnapshot): Promise<void> {
  scheduleUpload(userId, history);
}

// ───────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────

/**
 * Persist a user or assistant message to 0G Storage.
 *
 * Cannot throw in practice: `coerceSnapshot` guarantees `history.entries`
 * is a real array (the production `push is not a function` failure mode is
 * impossible), and the 0G Storage write is fire-and-forget. The agent loop
 * can safely call this without a try/catch wrapper.
 */
export async function recordMessage(
  userId: string,
  role: MessageRole,
  content: string,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'msg',
    data: { ts: Date.now(), role, content },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

/**
 * Persist a tool call (the LLM requested a function, we executed it).
 *
 * Cannot throw: see recordMessage for the design rationale.
 */
export async function recordToolCall(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'tool',
    data: { ts: Date.now(), tool, args, result },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

/**
 * Persist an on-chain transaction (for future use when send_tokens is added).
 *
 * Cannot throw: see recordMessage for the design rationale.
 */
export async function recordTx(
  userId: string,
  tx: Omit<StoredTx, 'ts'>,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'tx',
    data: { ...tx, ts: Date.now() },
  });
  // Fire-and-forget 0G Storage write for speed; cache already updated
  saveHistory(userId, history).catch(() => {});
}

export interface TxStats {
  count: number; // total transactions the bot has recorded
  byType: Record<string, number>; // e.g. { send: 3, swap: 2 }
  volumeByUnit: Record<string, string>; // summed amount per token unit, e.g. { OG: "1.6", USDC: "200" }
}

/** Round a float to a clean decimal string (drops float noise + trailing zeros). */
function cleanNum(n: number): string {
  return Number(n.toFixed(6)).toString();
}

/**
 * Aggregate the user's bot-recorded transactions: total count, a per-type
 * breakdown, and total volume summed per token unit. Amounts are stored as
 * labels like "0.1 OG" / "5 WOG", so we parse the leading number + unit.
 */
export async function transactionStats(
  userId: string,
  fromTs?: number,
  toTs?: number,
): Promise<TxStats> {
  const history = await loadHistory(userId);
  const byType: Record<string, number> = {};
  const volume: Record<string, number> = {};
  let count = 0;

  for (const entry of history.entries) {
    if (entry.kind !== 'tx') continue;
    const tx = entry.data as StoredTx;
    if (fromTs && tx.ts < fromTs) continue;
    if (toTs && tx.ts > toTs) continue;
    count++;
    byType[tx.type] = (byType[tx.type] ?? 0) + 1;
    if (tx.amount) {
      const m = tx.amount.match(/([\d.]+)\s*([A-Za-z]+)?/);
      if (m) {
        const val = parseFloat(m[1]!);
        const unit = (m[2] ?? 'OG').toUpperCase();
        if (!Number.isNaN(val)) volume[unit] = (volume[unit] ?? 0) + val;
      }
    }
  }

  const volumeByUnit: Record<string, string> = {};
  for (const [unit, val] of Object.entries(volume)) volumeByUnit[unit] = cleanNum(val);
  return { count, byType, volumeByUnit };
}

/**
 * Persist a TEE-verification proof for an AI reply.
 *
 * Called by `aiHandler` after every final assistant turn. Like the other
 * record* functions, the 0G Storage write is fire-and-forget — the cache is
 * already updated synchronously so subsequent reads see the proof.
 *
 * Cannot throw: see recordMessage for the design rationale.
 */
export async function recordProof(
  userId: string,
  proof: Omit<StoredProof, 'ts'>,
): Promise<void> {
  const history = await loadHistory(userId);
  history.entries.push({
    kind: 'proof',
    data: { ...proof, ts: Date.now() },
  });
  saveHistory(userId, history).catch(() => {});
}

/**
 * Get the N most recent MESSAGE entries for a user.
 *
 * Returns a chronological array (oldest first, newest last), useful for
 * passing as LLM conversation history.
 */
export async function getRecent(
  userId: string,
  limit: number = config.OG_MEMORY_CONTEXT_WINDOW,
): Promise<StoredMessage[]> {
  const history = await loadHistory(userId);
  const msgs = history.entries
    .filter((e): e is MemoryEntry & { kind: 'msg' } => e.kind === 'msg')
    .map((e) => e.data as StoredMessage);
  return msgs.slice(-limit);
}

/**
 * Get the most recent TEE-verification proofs for a user, newest first.
 * Powers the `/proof` command.
 */
export async function getRecentProofs(
  userId: string,
  limit: number = 10,
): Promise<StoredProof[]> {
  const history = await loadHistory(userId);
  const proofs = history.entries
    .filter((e): e is MemoryEntry & { kind: 'proof' } => e.kind === 'proof')
    .map((e) => e.data as StoredProof);
  // Newest first
  proofs.sort((a, b) => b.ts - a.ts);
  return proofs.slice(0, limit);
}

/**
 * Search a user's memory by free-text query and/or time range.
 *
 * @param userId   Telegram user ID
 * @param query    Optional substring to match (case-insensitive) against content
 * @param fromTs   Optional Unix-ms timestamp lower bound (inclusive)
 * @param toTs     Optional Unix-ms timestamp upper bound (inclusive)
 * @param limit    Max results to return (default: config.OG_MEMORY_SEARCH_LIMIT)
 * @returns        Array of matching entries (newest first), each tagged with `kind`
 */
export async function search(
  userId: string,
  query?: string,
  fromTs?: number,
  toTs?: number,
  limit: number = config.OG_MEMORY_SEARCH_LIMIT,
): Promise<SearchEntry[]> {
  const history = await loadHistory(userId);
  const results: SearchEntry[] = [];

  for (const entry of history.entries) {
    const data = entry.data;

    // Time filter
    if (fromTs && data.ts < fromTs) continue;
    if (toTs && data.ts > toTs) continue;

    // Text filter
    if (query) {
      const q = query.toLowerCase();
      let haystack = '';
      if (entry.kind === 'msg') {
        haystack = (data as StoredMessage).content.toLowerCase();
      } else if (entry.kind === 'tool') {
        const t = data as StoredToolCall;
        haystack = `${t.tool} ${JSON.stringify(t.args)} ${JSON.stringify(t.result)}`.toLowerCase();
      } else if (entry.kind === 'tx') {
        const tx = data as StoredTx;
        haystack = `${tx.type} ${tx.amount ?? ''} ${tx.to ?? ''} ${tx.hash}`.toLowerCase();
      }
      if (!haystack.includes(q)) continue;
    }

    results.push({ ...data, kind: entry.kind });
  }

  // Sort newest first, then apply limit
  results.sort((a, b) => b.ts - a.ts);
  return results.slice(0, limit);
}

/**
 * Clear all memory for a user.
 *
 * Clears the in-memory cache and the local root-hash index.
 * The actual snapshot data on 0G Storage is immutable (cannot be deleted) —
 * but we forget the rootHash, so we can no longer find it.
 */
export async function clearMemory(userId: string): Promise<void> {
  // Cancel any pending debounced upload so it doesn't fire after we've cleared
  // the index and re-upload stale data (which would re-add the rootHash entry).
  const pending = pendingUploads.get(userId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingUploads.delete(userId);
  }
  cache.delete(userId);
  if (memoryEnabled()) {
    await clearIndex(userId);
  }
}

/**
 * Flush ALL pending debounced uploads immediately. Called from the graceful
 * shutdown handler (index.ts) so that a `fly deploy` (SIGTERM) doesn't drop
 * the last ~2s of writes sitting in the debounce window.
 *
 * Race against a hard timeout — a single 0G Storage upload takes 2–5s, and
 * uploads are serialized through fileStorage's single-operator-wallet queue.
 * With a 4s cap we typically flush 1–2 uploads; the rest are abandoned (same
 * data-loss window as today, no regression). If the upload completes within
 * the cap, zero data is lost.
 */
export async function flushAllPendingUploads(timeoutMs: number = 4000): Promise<void> {
  const userIds = Array.from(pendingUploads.keys());
  if (userIds.length === 0) return;

  console.log(`[memory] flushing ${userIds.length} pending upload(s) on shutdown...`);

  const flushPromises: Promise<void>[] = [];
  for (const userId of userIds) {
    const entry = pendingUploads.get(userId);
    if (!entry) continue;
    clearTimeout(entry.timer);
    flushPromises.push(flushUpload(userId));
  }

  await Promise.race([
    Promise.allSettled(flushPromises),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn(`[memory] shutdown flush timed out after ${timeoutMs}ms — some uploads may be lost`);
        resolve();
      }, timeoutMs),
    ),
  ]);
}
