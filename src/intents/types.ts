/**
 * Intent types for the Scheduled Intents Engine (DCA + Alerts).
 *
 * Two intent types:
 *   - DCA:    recurring swap of a fixed amount on a schedule
 *   - Alert:  one-shot Telegram message when a price condition is met
 *
 * Both survive bot restarts via the intentStore (local mirror + 0G Storage).
 *
 * Status transitions:
 *   active ──► paused ──► active (via /pause <id> / resume button)
 *   active ──► cancelled (via /cancel <id>; removed from store)
 *   alert:   active ──► fired   (when condition met, one-shot)
 */
import { z } from 'zod';

/** Lifecycle status for an intent. */
export const IntentStatusSchema = z.enum(['active', 'paused', 'fired']);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

/** Comparison operator for price alerts. */
export const AlertOperatorSchema = z.enum(['<', '>', '<=', '>=']);
export type AlertOperator = z.infer<typeof AlertOperatorSchema>;

/**
 * Parsed schedule form. We keep the raw human-readable string for display
 * alongside the structured form so computeNextRun is a pure function.
 */
export const ScheduleSchema = z.object({
  raw: z.string(), // original user input, e.g. "every 6 hours"
  kind: z.enum(['interval']), // v1 only; reserved for cron/weekly-day in v2
  intervalMs: z.number().int().positive(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

// ── DCA intent ───────────────────────────────────────────────────────────

export const DcaIntentSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.literal('dca'),
  status: IntentStatusSchema,
  fromToken: z.string(), // 'OG' | 'WOG' | 0x address
  toToken: z.string(), // 'USDC' | 'USDT' | 'WOG' | 0x address
  amount: z.string(), // human-readable decimal string of the INPUT token
  schedule: ScheduleSchema,
  walletId: z.string(), // 8-char hex wallet id; resolves to user's wallet
  nextRunAt: z.number().int(), // unix-ms; when worker should next fire
  lastExecutedAt: z.number().int().nullable(), // null until first fire
  createdAt: z.number().int(),
});
export type DcaIntent = z.infer<typeof DcaIntentSchema>;

// ── Alert intent ─────────────────────────────────────────────────────────

export const AlertIntentSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.literal('alert'),
  status: IntentStatusSchema,
  symbol: z.string(), // user-facing symbol e.g. "OG"
  coingeckoId: z.string(), // resolved CoinGecko id e.g. "zero-gravity"
  operator: AlertOperatorSchema,
  threshold: z.number().positive(),
  lastCheckedAt: z.number().int().nullable(),
  firedAt: z.number().int().nullable(), // null until condition met
  createdAt: z.number().int(),
});
export type AlertIntent = z.infer<typeof AlertIntentSchema>;

export const IntentSchema = z.discriminatedUnion('type', [DcaIntentSchema, AlertIntentSchema]);
export type Intent = z.infer<typeof IntentSchema>;

/** True if the worker should execute this intent at `now`. */
export function isDue(intent: Intent, now: number): boolean {
  if (intent.status !== 'active') return false;
  if (intent.type === 'dca') return intent.nextRunAt <= now;
  // alerts have no schedule; the worker always re-checks their price
  return true;
}

/** Compute the next run timestamp for a DCA schedule, given a reference `fromTs`. */
export function computeNextRun(schedule: Schedule, fromTs: number): number {
  return fromTs + schedule.intervalMs;
}

/** Short human summary used in /intents listings and bot messages. */
export function summarize(intent: Intent): string {
  if (intent.type === 'dca') {
    return `DCA: ${intent.amount} ${intent.fromToken} → ${intent.toToken} (${intent.schedule.raw})`;
  }
  const op =
    intent.operator === '<'
      ? 'below'
      : intent.operator === '>'
        ? 'above'
        : intent.operator === '<='
          ? 'at or below'
          : 'at or above';
  return `Alert: ${intent.symbol} ${op} $${intent.threshold}`;
}
