/**
 * USD pricing service via CoinGecko free API.
 *
 * Design:
 *  - Symbol → CoinGecko ID mapping: 0G/OG → zero-gravity, WOG → wrapped-0g.
 *  - Mock testnet stablecoins (USDC, USDT) are hardcoded at $1 (they have no
 *    real market price on testnet).
 *  - 60-second in-memory TTL cache to stay well within CoinGecko's
 *    free-tier rate limit (~30 req/min).
 *  - 24-hour LRU fallback cache: when CoinGecko is unreachable, the last
 *    known price is served (up to 24h old). This prevents transient
 *    outages from breaking portfolio display.
 *  - All unknown symbols return null — never throw.
 */

// ── Mappings ──────────────────────────────────────────────────────────

const SYMBOL_TO_ID: Record<string, string> = {
  '0G': 'zero-gravity',
  'OG': 'zero-gravity',
  'WOG': 'wrapped-0g',
};

/** Stablecoin prices hardcoded for testnet mock tokens that have no real market price. */
const STABLECOIN_HARDCODE: Record<string, number> = {
  USDC: 1,
  USDT: 1,
};

// ── Cache layers ───────────────────────────────────────────────────────

interface CacheEntry {
  value: number | null;
  expiry: number; // ms timestamp
}

interface FallbackEntry {
  value: number;
  ts: number; // ms timestamp
}

/** 60-second short-lived cache. */
const priceCache = new Map<string, CacheEntry>();

/**
 * 24-hour LRU fallback cache.
 * "LRU" is simplified: we only store one entry per ID and evict when stale.
 */
const fallbackCache = new Map<string, FallbackEntry>();
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1_000;

const CACHE_TTL_MS = 60_000; // 60 seconds
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ── Core helpers ───────────────────────────────────────────────────────

/**
 * Return all unique CoinGecko IDs that we track. Used for batch fetching.
 */
function allTrackedIds(): string[] {
  return [...new Set(Object.values(SYMBOL_TO_ID))];
}

/**
 * Fetch USD prices for ALL tracked IDs from CoinGecko in a single call.
 * Updates both caches on success. Returns a map of id → price.
 */
async function refreshAllPrices(): Promise<Map<string, number | null>> {
  const ids = allTrackedIds().join(',');
  const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko returned ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, { usd?: number }>;
  const result = new Map<string, number | null>();

  for (const id of allTrackedIds()) {
    const raw = data[id];
    const price = raw?.usd ?? null;
    result.set(id, price);

    // Update short-lived cache
    priceCache.set(id, { value: price, expiry: Date.now() + CACHE_TTL_MS });

    // Update fallback cache (only when we got a real number)
    if (price !== null) {
      fallbackCache.set(id, { value: price, ts: Date.now() });
    }
  }

  return result;
}

/**
 * Look up a price from the 24-hour fallback cache.
 * Returns null if no fallback exists or it has expired.
 */
function getFallback(id: string): number | null {
  const entry = fallbackCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > FALLBACK_TTL_MS) {
    fallbackCache.delete(id);
    return null;
  }
  return entry.value;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get the USD price for a given token symbol.
 *
 * Resolution order:
 *  1. Hardcoded stablecoins (USDC, USDT → $1).
 *  2. Symbol → CoinGecko ID mapping → 60s cache hit.
 *  3. Fresh CoinGecko API call (batches all tracked IDs).
 *  4. 24h fallback cache (if CoinGecko is unavailable).
 *  5. Return null (unknown symbol or unreachable API with no fallback).
 *
 * Never throws.
 */
export async function getPriceUSD(symbol: string): Promise<number | null> {
  const upper = symbol.toUpperCase().trim();

  // 1. Hardcoded stablecoins
  const stable = STABLECOIN_HARDCODE[upper];
  if (stable !== undefined) return stable;

  // 2. Resolve to CoinGecko ID
  const coinGeckoId = SYMBOL_TO_ID[upper];
  if (!coinGeckoId) return null; // completely unknown symbol

  // 3. Check short-lived cache
  const cached = priceCache.get(coinGeckoId);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }

  // 4. Batch-refresh from CoinGecko
  try {
    await refreshAllPrices();
    const fresh = priceCache.get(coinGeckoId);
    if (fresh && fresh.expiry > Date.now()) {
      return fresh.value;
    }
    // If the API returned no data for this ID, try fallback
  } catch {
    // CoinGecko unreachable — fall through to fallback cache
  }

  // 5. 24h fallback
  return getFallback(coinGeckoId);
}

/**
 * Direct CoinGecko ID lookup (for `/price <any-coingecko-id>`).
 * Does NOT use the symbol mapping — passes the raw user input as a
 * CoinGecko API id. Has its own 60s cache keyed by the id.
 *
 * Never throws.
 */
export async function getPriceByCoinGeckoId(id: string): Promise<number | null> {
  const key = id.toLowerCase().trim();
  if (!key) return null;

  // Check cache (same TTL as symbol lookup)
  const cached = priceCache.get(`cgid:${key}`);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }

  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${key}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const price = data[key]?.usd ?? null;

    priceCache.set(`cgid:${key}`, {
      value: price,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    if (price !== null) {
      fallbackCache.set(`cgid:${key}`, { value: price, ts: Date.now() });
    }

    return price;
  } catch {
    return getFallback(`cgid:${key}`);
  }
}

// ── Known symbol list (for help / autocomplete) ────────────────────────

/** Symbols we know how to price (including stablecoins). */
export const KNOWN_SYMBOLS: string[] = [
  ...new Set([
    ...Object.keys(SYMBOL_TO_ID),
    ...Object.keys(STABLECOIN_HARDCODE),
  ]),
];

/**
 * Symbol → CoinGecko ID mapping (stablecoins excluded — they have no real market
 * price and are hardcoded to $1). Exported so callers that need to store the
 * canonical ID (e.g. the alert worker) can resolve without a round-trip.
 */
export const SYMBOL_TO_COINGECKO_ID: Record<string, string> = { ...SYMBOL_TO_ID };

/** True when the symbol has a real CoinGecko mapping (not a hardcoded stablecoin). */
export function hasCoinGeckoId(symbol: string): boolean {
  const upper = symbol.toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(SYMBOL_TO_COINGECKO_ID, upper);
}
