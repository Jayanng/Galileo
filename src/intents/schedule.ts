/**
 * Natural-language schedule parser for the Scheduled Intents Engine.
 *
 * Accepts strings like "daily", "weekly", "every 6 hours", "every 30 minutes",
 * "hourly". Returns a structured `Schedule` whose `intervalMs` lets the worker
 * compute the next run timestamp with a single addition.
 *
 * Naming-only patterns (e.g. "every Monday") are normalized to the matching
 * interval (7 days for weekdays) — v1 keeps the day-of-week in `raw` for display
 * but does not yet honour a specific day-of-week anchor.
 */
import type { Schedule } from './types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const PRESETS: Record<string, number> = {
  hourly: HOUR_MS,
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
};

const EVERY_RE = /^\s*every\s+(\d+)\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*$/i;
const BARE_INTERVAL_RE = /^\s*(\d+)\s+(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\s*$/i;
const WEEKDAY_RE = /^\s*every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*$/i;

const UNIT_MS: Record<string, number> = {
  minute: 60 * 1000,
  minutes: 60 * 1000,
  min: 60 * 1000,
  mins: 60 * 1000,
  hour: HOUR_MS,
  hours: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  day: DAY_MS,
  days: DAY_MS,
};

export class ScheduleParseError extends Error {}

/**
 * Parse a free-form schedule string into a structured Schedule.
 * Throws ScheduleParseError on unknown or empty input.
 */
export function parseSchedule(input: string): Schedule {
  const raw = input.trim();
  if (!raw) throw new ScheduleParseError('Schedule cannot be empty.');

  // Normalize "in the next 1 minute" / "in 30 mins" → bare interval.
  // Keep `raw` in the return value for display (user's original phrasing).
  const normalized = raw.replace(/^in\s+(?:the\s+next\s+)?(.+)$/i, '$1').trim();
  const lower = normalized.toLowerCase();

  if (PRESETS[lower] !== undefined) {
    return { raw, kind: 'interval', intervalMs: PRESETS[lower]! };
  }

  const every = EVERY_RE.exec(normalized);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2]!.toLowerCase();
    if (!Number.isFinite(n) || n <= 0) {
      throw new ScheduleParseError(`Invalid interval "${raw}".`);
    }
    return { raw, kind: 'interval', intervalMs: n * UNIT_MS[unit]! };
  }

  // Bare number+unit without "every": "1 min", "30 mins", "2 hours", "1 day"
  const bare = BARE_INTERVAL_RE.exec(normalized);
  if (bare) {
    const n = Number(bare[1]);
    const unit = bare[2]!.toLowerCase();
    if (!Number.isFinite(n) || n <= 0) {
      throw new ScheduleParseError(`Invalid interval "${raw}".`);
    }
    return { raw, kind: 'interval', intervalMs: n * UNIT_MS[unit]! };
  }

  if (WEEKDAY_RE.test(normalized)) {
    // v1 simplification: weekday-named schedules use a 7-day interval.
    // The day name is preserved in `raw` so the UI can show it accurately.
    return { raw, kind: 'interval', intervalMs: 7 * DAY_MS };
  }

  throw new ScheduleParseError(
    `Unknown schedule "${raw}". Try: "daily", "weekly", "hourly", "1 min", "30 mins", "2 hours", or "every N minutes/hours/days".`,
  );
}
