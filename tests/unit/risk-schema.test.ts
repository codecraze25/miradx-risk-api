import { describe, expect, it } from 'vitest';
import {
  findOffDayActionIndexes,
  isValidCalendarTimestamp,
  riskRequestSchema,
} from '../../src/schemas/risk.schema.js';

describe('isValidCalendarTimestamp', () => {
  it.each([
    '2022-01-01 00:00:00',
    '2022-01-01 23:59:59',
    '2024-02-29 12:00:00', // leap year
    '2000-02-29 12:00:00', // divisible by 400
  ])('accepts %s', (value) => {
    expect(isValidCalendarTimestamp(value)).toBe(true);
  });

  it.each([
    '2022-02-29 12:00:00', // not a leap year
    '1900-02-29 12:00:00', // divisible by 100, not 400
    '2022-04-31 12:00:00',
    '2022-13-01 12:00:00',
    '2022-00-10 12:00:00',
    '2022-01-00 12:00:00',
    '2022-01-01 24:00:00',
    '2022-01-01 12:60:00',
    '2022-01-01 12:00:60',
    '0000-01-01 12:00:00',
    '2022-01-01T10:05:11', // ISO separator is not the documented format
    '2022-01-01 10:05:11Z',
    '2022-1-1 10:05:11',
  ])('rejects %s', (value) => {
    expect(isValidCalendarTimestamp(value)).toBe(false);
  });
});

describe('riskRequestSchema', () => {
  const valid = {
    commuterId: 'COM-123',
    actions: [
      { timestamp: '2022-01-01 00:00:00', action: 'a', unit: 'mile', quantity: 1 },
      { timestamp: '2022-01-01 23:59:59', action: 'b', unit: 'floor', quantity: 1 },
    ],
  };

  it('accepts timestamps at both ends of the same day', () => {
    expect(riskRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('flags every timestamp that is not on the first action’s day', () => {
    const result = riskRequestSchema.safeParse({
      ...valid,
      actions: [
        ...valid.actions,
        { timestamp: '2022-01-02 00:00:00', action: 'c', unit: 'minute', quantity: 1 },
        { timestamp: '2021-12-31 23:59:59', action: 'd', unit: 'minute', quantity: 1 },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ['actions', 2, 'timestamp'],
      ['actions', 3, 'timestamp'],
    ]);
  });

  it('does not coerce numeric strings into quantities', () => {
    const result = riskRequestSchema.safeParse({
      ...valid,
      actions: [{ ...valid.actions[0], quantity: '3' }],
    });

    expect(result.success).toBe(false);
  });

  it('reports a wrongly formatted timestamp once, not also as an invalid date', () => {
    const result = riskRequestSchema.safeParse({
      ...valid,
      actions: [{ ...valid.actions[0], timestamp: '2022-01-01T10:00:00Z' }],
    });

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'Timestamp must use the format "YYYY-MM-DD HH:mm:ss"',
    ]);
  });
});

describe('findOffDayActionIndexes', () => {
  it('uses the first valid timestamp as the reference and skips malformed entries', () => {
    expect(
      findOffDayActionIndexes([
        { timestamp: 'garbage' },
        null,
        { timestamp: '2022-03-01 08:00:00' },
        { timestamp: '2022-03-01 23:00:00' },
        { timestamp: '2022-03-02 00:00:00' },
      ]),
    ).toEqual([4]);
  });

  it('returns nothing for non-array input', () => {
    expect(findOffDayActionIndexes('not an array')).toEqual([]);
  });
});

describe('riskRequestSchema on non-object input', () => {
  it.each([null, undefined, 'x', 1, true, []])(
    'fails validation instead of throwing for %j',
    (input) => {
      expect(() => riskRequestSchema.safeParse(input)).not.toThrow();
      expect(riskRequestSchema.safeParse(input).success).toBe(false);
    },
  );
});
