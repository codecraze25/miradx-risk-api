import { describe, expect, it } from 'vitest';
import { calculateRisk, roundRisk } from '../../src/domain/risk-calculator.js';
import {
  createRiskCatalog,
  DEFAULT_RISK_DEFINITIONS,
  normalizeActionName,
} from '../../src/domain/risk-rates.js';
import type { Activity } from '../../src/types/risk.types.js';
import { testCatalog } from '../fixtures.js';

describe('calculateRisk', () => {
  it('multiplies quantity by the per-unit rate for a single activity', () => {
    const activities: Activity[] = [{ action: 'rode a shark', unit: 'minute', quantity: 3 }];

    expect(calculateRisk(activities, testCatalog)).toEqual({ ok: true, risk: 3000 });
  });

  it('sums the risk of multiple activities across all four units', () => {
    const activities: Activity[] = [
      { action: 'walked on sidewalk', unit: 'mile', quantity: 2 }, // 20
      { action: 'climbed stairs', unit: 'floor', quantity: 5 }, // 10
      { action: 'rode a shark', unit: 'minute', quantity: 1 }, // 1000
      { action: 'ate a pufferfish', unit: 'quantity', quantity: 2 }, // 100
    ];

    expect(calculateRisk(activities, testCatalog)).toEqual({ ok: true, risk: 1130 });
  });

  it('supports fractional quantities', () => {
    const activities: Activity[] = [
      { action: 'walked on sidewalk', unit: 'mile', quantity: 0.4 }, // 4
      { action: 'rode a shark', unit: 'minute', quantity: 0.25 }, // 250
    ];

    expect(calculateRisk(activities, testCatalog)).toEqual({ ok: true, risk: 254 });
  });

  it('removes floating-point noise only from the final total', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754
    const activities: Activity[] = [
      { action: 'tenth', unit: 'quantity', quantity: 1 },
      { action: 'tenth', unit: 'quantity', quantity: 2 },
    ];

    expect(calculateRisk(activities, testCatalog)).toEqual({ ok: true, risk: 0.3 });
  });

  it('matches action names case- and whitespace-insensitively', () => {
    const activities: Activity[] = [{ action: '  Rode   a SHARK ', unit: 'minute', quantity: 1 }];

    expect(calculateRisk(activities, testCatalog)).toEqual({ ok: true, risk: 1000 });
  });

  it('reports an unknown activity instead of treating it as zero risk', () => {
    const activities: Activity[] = [
      { action: 'rode a shark', unit: 'minute', quantity: 1 },
      { action: 'juggled chainsaws', unit: 'minute', quantity: 1 },
    ];

    expect(calculateRisk(activities, testCatalog)).toEqual({
      ok: false,
      issues: [
        {
          index: 1,
          reason: 'UNKNOWN_ACTIVITY',
          message: 'No risk rate is configured for this action',
        },
      ],
    });
  });

  it('reports a unit that does not match the configured unit', () => {
    const activities: Activity[] = [{ action: 'rode a shark', unit: 'mile', quantity: 1 }];

    expect(calculateRisk(activities, testCatalog)).toEqual({
      ok: false,
      issues: [
        {
          index: 0,
          reason: 'UNIT_MISMATCH',
          message: 'This action is measured in "minute", not "mile"',
        },
      ],
    });
  });

  it('reports every problem in one pass and returns no partial total', () => {
    const activities: Activity[] = [
      { action: 'unknown thing', unit: 'mile', quantity: 1 },
      { action: 'walked on sidewalk', unit: 'mile', quantity: 1 },
      { action: 'climbed stairs', unit: 'minute', quantity: 1 },
    ];

    const result = calculateRisk(activities, testCatalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => [issue.index, issue.reason])).toEqual([
        [0, 'UNKNOWN_ACTIVITY'],
        [2, 'UNIT_MISMATCH'],
      ]);
    }
  });
});

describe('roundRisk', () => {
  it('rounds to six decimal places', () => {
    expect(roundRisk(1.23456789)).toBe(1.234568);
    expect(roundRisk(0.30000000000000004)).toBe(0.3);
  });
});

describe('risk catalog', () => {
  it('normalizes action names', () => {
    expect(normalizeActionName('  Walked\ton   Sidewalk ')).toBe('walked on sidewalk');
  });

  it('builds the default catalog without configuration errors', () => {
    expect(createRiskCatalog(DEFAULT_RISK_DEFINITIONS).size).toBe(DEFAULT_RISK_DEFINITIONS.length);
  });

  it('labels every default rate as illustrative rather than validated', () => {
    for (const definition of DEFAULT_RISK_DEFINITIONS) {
      expect(definition.source).toMatch(/illustrative/i);
    }
  });

  it('rejects duplicate actions after normalization', () => {
    expect(() =>
      createRiskCatalog([
        { action: 'Rode a shark', unit: 'minute', micromortsPerUnit: 1, source: 'test' },
        { action: 'rode a  shark', unit: 'mile', micromortsPerUnit: 1, source: 'test' },
      ]),
    ).toThrow('Duplicate risk definition for action "rode a shark"');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])(
    'rejects an invalid rate of %s',
    (rate) => {
      expect(() =>
        createRiskCatalog([{ action: 'x', unit: 'mile', micromortsPerUnit: rate, source: 'test' }]),
      ).toThrow('Invalid micromortsPerUnit');
    },
  );
});
