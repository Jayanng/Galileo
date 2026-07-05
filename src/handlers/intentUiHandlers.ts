import { type Context } from 'grammy';
import { executeTool } from '../ai/toolExecutor';
import { isSupportedDcaPath } from '../intents';

const PROOF_VERIFY_URL = 'https://galileo-test.fly.dev/verify/';

/**
 * Deterministic DCA + alert UX — the reliable path to a stored intent.
 *
 * Same rationale as src/handlers/swapUiHandlers.ts: the AI `dca_create` and
 * `alert_create` tools depend on the 7B model emitting correct tool calls,
 * which it does inconsistently (phrases like "dca me 1 OG into USDC weekly"
 * or "alert me when OG is under $1" sometimes lose params). These parsers
 * stage intents directly from clear, common phrasings, with zero LLM
 * involvement. Anything fuzzy falls through to the AI agent.
 *
 * The staged call reuses executeTool() from src/ai/toolExecutor.ts, so all
 * validation (parseSchedule, isSupportedDcaPath, symbol resolution, ownership)
 * runs the same code path as the AI-driven flow. Result rendering is the only
 * difference — the deterministic path replies with a plain Telegram message
 * instead of asking the LLM to phrase it.
 */

function userIdOf(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id ? String(id) : null;
}

// ── DCA parser ──────────────────────────────────────────────────────────

export interface DcaDraft {
  amount: string;
  fromToken: string;
  toToken: string;
  schedule: string;
}

/**
 * Match common DCA phrasings:
 *   "dca 1 OG into USDC weekly"
 *   "dca me 1 OG into USDC every 6 hours"
 *   "dollar-cost average 0.5 OG into USDT daily"
 *   "dollar cost average 1 OG into USDC weekly"
 *   "recurring swap 1 OG to USDC every Monday"
 *
 * Returns the extracted draft or null if the phrase doesn't match a clear shape.
 */
export function parseDcaText(text: string): DcaDraft | null {
  const re = /^(?:dca(?:\s+me)?|dollar[\s-]cost\s+average|recurring\s+swap)\s+([\d.]+)\s+(\w+)\s+(?:into|to|for)\s+(\w+)\s+(.+)$/i;
  const m = re.exec(text.trim());
  if (!m) return null;
  const amount = m[1]!;
  const fromToken = m[2]!.toUpperCase();
  const toToken = m[3]!.toUpperCase();
  const schedule = m[4]!.trim();
  return { amount, fromToken, toToken, schedule };
}

/** Stage a DCA intent from a parsed draft. Reuses executeTool for validation. */
export async function stageDca(ctx: Context, userId: string, draft: DcaDraft): Promise<void> {
  // Cheap pre-check so common mistakes fail fast with a clear message instead
  // of a round-trip through the executor.
  if (!isSupportedDcaPath(draft.fromToken, draft.toToken)) {
    await ctx.reply(
      `⚠️ DCA path ${draft.fromToken}→${draft.toToken} isn't supported yet. Try OG→USDC, OG→USDT, OG→WOG (wrap), or WOG→OG (unwrap).`,
    );
    return;
  }
  const res = await executeTool(userId, 'dca_create', draft);
  if (!res.success) {
    await ctx.reply(`⚠️ ${res.error}`);
    return;
  }
  const data = res.data as { id: string; summary: string; schedule: string; nextRunAt: string; receiptId?: string | null; receiptRootHash?: string | null };
  const receiptLine = data.receiptRootHash
    ? `\n🧾 Receipt: [0x${data.receiptRootHash.slice(2, 12)}…](${PROOF_VERIFY_URL}${data.receiptRootHash})`
    : '';
  await ctx.reply(
    `✅ *DCA scheduled*\n${data.summary}\nRuns every: \`${data.schedule}\`\nNext at: \`${data.nextRunAt}\`${receiptLine}\n\nManage: /intents`,
    { parse_mode: 'Markdown' },
  );
}

// ── Alert parser ─────────────────────────────────────────────────────────

export interface AlertDraft {
  symbol: string;
  operator: '<' | '>' | '<=' | '>=';
  threshold: number;
}

const PRICE_RE = /^\$?([\d.]+)([kmb]?)$/i;
function parsePrice(raw: string): number | null {
  const m = PRICE_RE.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const suffix = (m[2] || '').toLowerCase();
  const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : suffix === 'b' ? 1e9 : 1;
  return n * mult;
}

/**
 * Match common alert phrasings:
 *   "alert me if OG drops below $1"
 *   "alert me when OG is above $5"
 *   "alert me if OG goes below $0.50"
 *   "notify me if bitcoin falls under $30k"
 *   "tell me when ETH rises above $3000"
 *   "alert me if OG < $1"  (compact)
 *
 * Operator keywords:
 *   "<": below, under, drops below, falls below, falls under, less than
 *   ">": above, over, goes above, rises above, more than
 *
 * Suffixes supported on the price: 1k = 1,000; 1m = 1,000,000; 1b = 1,000,000,000.
 */
export function parseAlertText(text: string): AlertDraft | null {
  const t = text.trim();

  // Verbose: "alert me [when] [if] SYM (drops|falls|is) (below|under)|(goes|rises|is) (above|over) $PRICE"
  const verbose = /^(?:alert\s+me(?:\s+when)?|notify\s+me(?:\s+when)?|tell\s+me(?:\s+when)?)\s+(?:if\s+)?(\w+)\s+((?:drops|falls|is)\s+(?:below|under)|(?:goes|rises|is)\s+(?:above|over))\s+\$?([\d.]+[kmb]?)$/i;
  const v = verbose.exec(t);
  if (v) {
    const symbol = v[1]!;
    const phrase = v[2]!.toLowerCase();
    const threshold = parsePrice(v[3]!);
    if (threshold === null) return null;
    const operator: '<' | '>' = /below|under/.test(phrase) ? '<' : '>';
    return { symbol, operator, threshold };
  }

  // Compact: "alert me if SYM (op) $PRICE"
  const compact = /^(?:alert\s+me(?:\s+when)?|notify\s+me(?:\s+when)?|tell\s+me(?:\s+when)?)\s+(?:if\s+)?(\w+)\s+([<>=]+)\s+\$?([\d.]+[kmb]?)$/i;
  const c = compact.exec(t);
  if (c) {
    const symbol = c[1]!;
    const opRaw = c[2]!;
    const threshold = parsePrice(c[3]!);
    if (threshold === null) return null;
    if (!['<', '>', '<=', '>='].includes(opRaw)) return null;
    return { symbol, operator: opRaw as '<' | '>' | '<=' | '>=', threshold };
  }

  return null;
}

// ── Recurring send (send schedule) parser ─────────────────────────────────

export interface SendScheduleDraft {
  recipient: string;
  amount: string;
  schedule: string;
}

/**
 * Match recurring send phrasings:
 *   "recurring send 1 OG to @alice daily"
 *   "recurring send 0.1 to 0xADDR every 6 hours"
 *   "schedule send 0.5 OG to @bob weekly"
 *   "send 0.1 OG to @alice every day"
 *   "recurring transfer 1 OG to 0xADDR hourly"
 *
 * Returns the extracted draft or null if the phrase doesn't match.
 */
export function parseSendScheduleText(text: string): SendScheduleDraft | null {
  // "recurring send|recurring transfer|schedule send <amount> [OG] to <recipient> <schedule>"
  const main = /^(?:recurring\s+(?:send|transfer)|schedule\s+send)\s+([\d.]+)\s*(?:og)?\s+to\s+(\S+)\s+(.+)$/i;
  let m = main.exec(text.trim());
  if (m) {
    return { amount: m[1]!, recipient: m[2]!, schedule: m[3]!.trim() };
  }
  // "send <amount> [OG] to <recipient> every|daily|weekly|hourly" — catches "send 0.1 OG to @alice every day"
  const sendEvery = /^send\s+([\d.]+)\s*(?:og)?\s+to\s+(\S+)\s+(every\s+.+|daily|weekly|hourly|hour|day|week)$/i;
  m = sendEvery.exec(text.trim());
  if (m) {
    return { amount: m[1]!, recipient: m[2]!, schedule: m[3]!.trim() };
  }
  return null;
}

/** Stage a recurring send from a parsed draft. Reuses executeTool for validation. */
export async function stageSendSchedule(ctx: Context, userId: string, draft: SendScheduleDraft): Promise<void> {
  const res = await executeTool(userId, 'send_schedule_create', draft);
  if (!res.success) {
    await ctx.reply(`⚠️ ${res.error}`);
    return;
  }
  const data = res.data as { id: string; summary: string; schedule: string; nextRunAt: string; receiptId?: string | null; receiptRootHash?: string | null };
  const PROOF_VERIFY_URL = 'https://galileo-test.fly.dev/verify/';
  const receiptLine = data.receiptRootHash
    ? `\n🧾 Receipt: [0x${data.receiptRootHash.slice(2, 12)}…](${PROOF_VERIFY_URL}${data.receiptRootHash})`
    : '';
  await ctx.reply(
    `✅ *Recurring send scheduled*\n${data.summary}\nRuns every: \`${data.schedule}\`\nNext at: \`${data.nextRunAt}\`${receiptLine}\n\nManage: /intents`,
    { parse_mode: 'Markdown' },
  );
}

/** Stage an alert intent from a parsed draft. Reuses executeTool for validation. */
export async function stageAlert(ctx: Context, userId: string, draft: AlertDraft): Promise<void> {
  const res = await executeTool(userId, 'alert_create', draft);
  if (!res.success) {
    await ctx.reply(`⚠️ ${res.error}`);
    return;
  }
  const data = res.data as { id: string; summary: string };
  await ctx.reply(
    `✅ *Alert armed*\n${data.summary}\nI'll message you when it triggers.\n\nManage: /intents`,
    { parse_mode: 'Markdown' },
  );
}
