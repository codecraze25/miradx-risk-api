import { createRiskCatalog } from '../src/domain/risk-rates.js';
import type { RiskCatalog } from '../src/types/risk.types.js';

/**
 * Fixed test catalog, independent of the illustrative default catalog, so that
 * expected totals in tests do not change when the default rates are edited.
 * Covers all four units.
 */
export const testCatalog: RiskCatalog = createRiskCatalog([
  { action: 'walked on sidewalk', unit: 'mile', micromortsPerUnit: 10, source: 'test' },
  { action: 'climbed stairs', unit: 'floor', micromortsPerUnit: 2, source: 'test' },
  { action: 'rode a shark', unit: 'minute', micromortsPerUnit: 1000, source: 'test' },
  { action: 'ate a pufferfish', unit: 'quantity', micromortsPerUnit: 50, source: 'test' },
  { action: 'tenth', unit: 'quantity', micromortsPerUnit: 0.1, source: 'test' },
]);

export interface TestAction {
  timestamp: string;
  action: string;
  unit: string;
  quantity: number;
}

export function action(overrides: Partial<TestAction> = {}): TestAction {
  return {
    timestamp: '2022-01-01 10:05:11',
    action: 'walked on sidewalk',
    unit: 'mile',
    quantity: 0.4,
    ...overrides,
  };
}
