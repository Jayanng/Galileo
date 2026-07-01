/**
 * Public surface for the Scheduled Intents Engine.
 *
 *   import { intentStore, parseSchedule, type Intent } from './intents';
 */
export type {
  Intent,
  DcaIntent,
  AlertIntent,
  Schedule,
  IntentStatus,
  AlertOperator,
} from './types';
export {
  IntentSchema,
  isDue,
  computeNextRun,
  summarize,
} from './types';
export { parseSchedule, ScheduleParseError } from './schedule';
export { intentStore, newIntentId, createIntentStore, LocalIntentStore } from './intentStore';
export type { IntentStore } from './intentStore';
export { isSupportedDcaPath } from './executor';
