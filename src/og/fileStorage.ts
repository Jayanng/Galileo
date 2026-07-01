import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';
import { operatorWallet } from './chain';

/**
 * 0G Storage File Mode wrapper.
 *
 * Stores each user's conversation history as a single rolling snapshot file
 * on 0G Storage. Each write uploads a new snapshot (the full updated history);
 * 0G Storage keeps all old snapshots forever (Merkle-rooted, immutable).
 *
 * We maintain a local index file (OG_STORAGE_INDEX_PATH) mapping userId to
 * the latest rootHash. This is a cache — if lost, the data is still on 0G
 * Storage, just harder to find.
 *
 * Verified API patterns from:
 * https://docs.0g.ai/developer-hub/building-on-0g/storage/sdk
 */

// Reuse a single Indexer instance (per docs best practice: "Initialize Once")
const indexer = new Indexer(config.OG_INDEXER_RPC);

// In-memory cache of userId → latest rootHash
const rootHashIndex = new Map<string, string>();
let indexLoaded = false;

// ─── Upload queue: serialises 0G uploads to prevent wallet nonce conflicts ───
// When multiple uploadJson calls fire concurrently (fire-and-forget from memory.ts),
// they race for the same wallet nonce, causing "nonce already used" errors.
// This queue ensures only one upload transaction is in-flight at any time.
const uploadQueue: Array<() => Promise<void>> = [];
let uploading = false;

async function processQueue(): Promise<void> {
  if (uploading) return;
  uploading = true;
  while (uploadQueue.length > 0) {
    const task = uploadQueue.shift();
    if (task) {
      try {
        await task();
      } catch {
        // Task errors are already logged inside uploadJson; swallow here
        // so the queue continues processing.
      }
    }
  }
  uploading = false;
}

function enqueue(fn: () => Promise<void>): void {
  uploadQueue.push(fn);
  processQueue();
}

async function loadIndex(): Promise<void> {
  if (indexLoaded) return;
  try {
    const raw = await fs.readFile(config.OG_STORAGE_INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(parsed)) {
      rootHashIndex.set(k, v);
    }
  } catch {
    // File doesn't exist yet — start with empty index. This is fine.
    console.log('[fileStorage] starting with empty root-hash index');
  }
  indexLoaded = true;
}

async function saveIndex(): Promise<void> {
  const obj: Record<string, string> = {};
  for (const [k, v] of rootHashIndex.entries()) obj[k] = v;
  await fs.mkdir(dirname(config.OG_STORAGE_INDEX_PATH), { recursive: true });
  await fs.writeFile(config.OG_STORAGE_INDEX_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Upload JSON-serializable data to 0G Storage under the user's namespace.
 * Returns the new rootHash (also persisted to the local index).
 *
 * Uploads are enqueued and processed serially to prevent wallet nonce
 * conflicts from concurrent fire-and-forget calls.
 *
 * Retries up to 3 times on failure with 1s, 2s, 4s backoff.
 *
 * @param userId Telegram user ID (used as the storage namespace)
 * @param data   Any JSON-serializable value (object, array, string, etc.)
 * @returns      The new rootHash (32-byte hex string)
 */
export async function uploadJson(
  userId: string,
  data: unknown,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    enqueue(async () => {
      await uploadWithRetry(userId, data, 0, resolve, reject);
    });
  });
}

/**
 * Upload with exponential backoff retry (max 3 attempts).
 */
async function uploadWithRetry(
  userId: string,
  data: unknown,
  attempt: number,
  resolve: (val: string) => void,
  reject: (err: Error) => void,
): Promise<void> {
  const maxAttempts = 3;
  try {
    // Serialize to JSON → UTF-8 bytes
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);

    // Wrap in MemData (the documented pattern for in-memory uploads)
    const memData = new MemData(bytes);

    // MUST call merkleTree() before upload
    await memData.merkleTree();

    // Upload to 0G Storage
    const [tx, err] = await indexer.upload(
      memData,
      config.OG_RPC,
      operatorWallet,
    );

    if (err || !('rootHash' in tx)) {
      throw new Error(typeof err === 'string' ? err : err?.message || 'unknown error');
    }

    // Update index
    await loadIndex();
    rootHashIndex.set(userId, tx.rootHash);
    await saveIndex();

    console.log(`[fileStorage] uploaded ${bytes.length} bytes for user=${userId} rootHash=${tx.rootHash}`);
    resolve(tx.rootHash);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (attempt + 1 < maxAttempts) {
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.warn(
        `[fileStorage] upload attempt ${attempt + 1}/${maxAttempts} failed for user=${userId}, retrying in ${delay}ms: ${msg}`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return uploadWithRetry(userId, data, attempt + 1, resolve, reject);
    }
    reject(new Error(`[fileStorage] upload failed after ${maxAttempts} attempts for user=${userId}: ${msg}`));
  }
}

/**
 * Download the user's latest snapshot from 0G Storage.
 * Returns the parsed JSON or null (if no snapshot exists).
 */
export async function downloadJson<T>(userId: string): Promise<T | null> {
  await loadIndex();
  const rootHash = rootHashIndex.get(userId);
  if (!rootHash) return null;

  try {
    // Download as a Blob
    const [blob, err] = await indexer.downloadToBlob(rootHash, {
      proof: true,
    });

    if (err || !blob) {
      console.warn(`[fileStorage] download failed for user=${userId} rootHash=${rootHash}: ${err}`);
      return null;
    }

    // Parse bytes back to JSON
    const text = await blob.text();
    return JSON.parse(text) as T;
  } catch (e) {
    console.warn(`[fileStorage] error reading snapshot for user=${userId}:`, e);
    return null;
  }
}

/**
 * Clear the index (effectively forgetting a user's memory).
 * (The data remains on 0G Storage, but we can no longer find it).
 */
export async function clearIndex(userId: string): Promise<void> {
  await loadIndex();
  rootHashIndex.delete(userId);
  await saveIndex();
}
