import type {
  Activity,
  ActivityIssue,
  RiskCalculationResult,
  RiskCatalog,
} from '../types/risk.types.js';
import { normalizeActionName } from './risk-rates.js';

/** Number of decimal places kept in the reported total. */
export const RISK_DECIMAL_PLACES = 6;

const ROUNDING_FACTOR = 10 ** RISK_DECIMAL_PLACES;

/**
 * Rounds a total for presentation. Applied once, to the final sum only, to
 * remove binary floating-point noise (e.g. 0.1 + 0.2) without losing
 * meaningful precision.
 */
export function roundRisk(value: number): number {
  return Math.round(value * ROUNDING_FACTOR) / ROUNDING_FACTOR;
}

/**
 * Calculates total risk in micromorts:
 *
 *   activityRisk = quantity × micromortsPerUnit
 *   totalRisk    = Σ activityRisk
 *
 * Pure and deterministic. Every activity must have a catalog entry in the
 * same unit; otherwise all problems are reported together rather than one at
 * a time, and no partial total is returned.
 */
export function calculateRisk(
  activities: readonly Activity[],
  catalog: RiskCatalog,
): RiskCalculationResult {
  const issues: ActivityIssue[] = [];
  let total = 0;

  activities.forEach((activity, index) => {
    const definition = catalog.get(normalizeActionName(activity.action));

    if (definition === undefined) {
      issues.push({
        index,
        reason: 'UNKNOWN_ACTIVITY',
        message: 'No risk rate is configured for this action',
      });
      return;
    }

    if (definition.unit !== activity.unit) {
      issues.push({
        index,
        reason: 'UNIT_MISMATCH',
        message: `This action is measured in "${definition.unit}", not "${activity.unit}"`,
      });
      return;
    }

    total += activity.quantity * definition.micromortsPerUnit;
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, risk: roundRisk(total) };
}
