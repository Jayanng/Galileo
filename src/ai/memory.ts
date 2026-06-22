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
 * Memory is best-effort: if 0G Storage is unavailable, we log a warning and
 * continue (the bot must never crash due to a memory write failure).
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

export type MemoryEntry =
  | { kind: 'msg'; data: StoredMessage }
  | { kind: 'tool'; data: StoredToolCall }
  | { kind: 'tx'; data: StoredTx };

/** Search result type: flattened entry with a `kind` discriminator. */
export type SearchEntry = (StoredMessage | StoredToolCall | StoredTx) & {
  kind: 'msg' | 'tool' | 'tx';
};

// ───────────────────────────────────────────────────────────────────────
// Internal: Snapshot structure stored on 0G
// ───────────────────────────────────────────────────────────────────────

interface HistorySnapshot {
  entries: MemoryEntry[];
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
      const snapshot: HistorySnapshot = data || { entries: [] };
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
 * Save history back to 0G Storage (best-effort).
 * Compacts before uploading so the snapshot size stays bounded.
 */
async function saveHistory(userId: string, history: HistorySnapshot): Promise<void> {
  if (!memoryEnabled()) return;
  compact(userId, history);
  cache.set(userId, history);
  try {
    await uploadJson(userId, history);
  } catch (e) {
    console.warn(`[memory] saveHistory failed for user=${userId}:`, (e as Error).message);
  }
}

// ───────────────────────────────────────────────────────────────────────
// PUBLIC API
// ───────────────────────────────────────────────────────────────────────

/**
 * Persist a user or assistant message to 0G Storage.
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
  cache.delete(userId);
  if (memoryEnabled()) {
    await clearIndex(userId);
  }
}
