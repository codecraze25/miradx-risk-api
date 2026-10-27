import { z } from 'zod';
import { UNITS } from '../types/risk.types.js';

export const MAX_ACTIONS = 1000;
export const MAX_COMMUTER_ID_LENGTH = 128;
export const MAX_ACTION_LENGTH = 200;
export const MAX_QUANTITY = 1_000_000;

/**
 * Timestamps use the exact format of the brief: "YYYY-MM-DD HH:mm:ss".
 * They carry no offset, so they are treated as local wall-clock times of the
 * commuter and are never converted to UTC or any other zone. "Same day" means
 * the same YYYY-MM-DD calendar date as written.
 */
export const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

/** True when a string matching TIMESTAMP_PATTERN is a real calendar date and time. */
export function isValidCalendarTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

/**
 * Indexes of actions whose (valid) timestamp is not on the same calendar date
 * as the first valid timestamp. Accepts unvalidated input: malformed entries
 * are skipped because they are reported by their own field rules.
 */
export function findOffDayActionIndexes(actions: unknown): number[] {
  if (!Array.isArray(actions)) {
    return [];
  }
  let referenceDate: string | undefined;
  const offDay: number[] = [];
  actions.forEach((action: unknown, index) => {
    if (typeof action !== 'object' || action === null || !('timestamp' in action)) {
      return;
    }
    const { timestamp } = action;
    if (typeof timestamp !== 'string' || !isValidCalendarTimestamp(timestamp)) {
      return;
    }
    const date = timestamp.slice(0, 10);
    referenceDate ??= date;
    if (date !== referenceDate) {
      offDay.push(index);
    }
  });
  return offDay;
}

/** Reads `actions` from a value that has not necessarily passed validation. */
function readActions(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'actions' in value
    ? value.actions
    : undefined;
}

const nonBlank = (value: string): boolean => value.trim().length > 0;

const timestampSchema = z
  .string()
  .regex(TIMESTAMP_PATTERN, {
    message: 'Timestamp must use the format "YYYY-MM-DD HH:mm:ss"',
    abort: true, // don't also report a calendar error for a wrongly formatted value
  })
  .refine(isValidCalendarTimestamp, 'Timestamp is not a valid calendar date and time');

const actionSchema = z.strictObject({
  timestamp: timestampSchema,
  action: z
    .string()
    .max(MAX_ACTION_LENGTH, `Action must be at most ${String(MAX_ACTION_LENGTH)} characters`)
    .refine(nonBlank, 'Action must be a non-empty string'),
  unit: z.enum(UNITS, { error: `Unit must be one of: ${UNITS.join(', ')}` }),
  quantity: z
    .number({
      // JSON numbers too large for a double (e.g. 1e400) parse to Infinity, which Zod
      // reports as a type error. Say what is actually wrong in that case.
      error: (issue) =>
        typeof issue.input === 'number'
          ? 'Quantity must be a finite number'
          : 'Quantity must be a number',
    })
    .positive('Quantity must be greater than zero')
    .max(MAX_QUANTITY, `Quantity must be at most ${String(MAX_QUANTITY)}`),
});

export const riskRequestSchema = z
  .strictObject({
    commuterId: z
      .string()
      .max(
        MAX_COMMUTER_ID_LENGTH,
        `commuterId must be at most ${String(MAX_COMMUTER_ID_LENGTH)} characters`,
      )
      .refine(nonBlank, 'commuterId must be a non-empty string'),
    actions: z
      .array(actionSchema)
      .min(1, 'At least one action is required')
      .max(MAX_ACTIONS, `At most ${String(MAX_ACTIONS)} actions are allowed per request`),
  })
  .superRefine(
    (request, ctx) => {
      for (const index of findOffDayActionIndexes(readActions(request))) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions', index, 'timestamp'],
          message: 'All action timestamps must be on the same day',
        });
      }
    },
    // Run even when other fields are invalid, so every problem is reported at once.
    // The value may therefore be anything (including null), so it is read as unknown.
    { when: () => true },
  );

export type RiskRequest = z.infer<typeof riskRequestSchema>;
