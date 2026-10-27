import type { RiskCatalog, RiskDefinition } from '../types/risk.types.js';

/**
 * Upper bound for a single rate. 1,000,000 micromorts is a probability of 1
 * (certain death) per unit, so a larger rate is always a configuration error.
 */
export const MAX_MICROMORTS_PER_UNIT = 1_000_000;

const ILLUSTRATIVE_SOURCE =
  'Illustrative, fictional value for this assessment. Not scientifically validated.';

/**
 * Default risk catalog.
 *
 * IMPORTANT: every rate below is an illustrative placeholder chosen only to
 * exercise the API. None of them is a real, validated micromort figure and
 * none was chosen to reproduce the sample response in the assessment brief.
 *
 * To add or change an activity, edit this list. Each activity is priced in
 * exactly one unit; the catalog builder rejects duplicates and invalid rates
 * at startup.
 */
export const DEFAULT_RISK_DEFINITIONS: readonly RiskDefinition[] = [
  {
    action: 'walked on sidewalk',
    unit: 'mile',
    micromortsPerUnit: 1,
    description: 'Walking alongside traffic on a pedestrian sidewalk.',
    source: ILLUSTRATIVE_SOURCE,
  },
  {
    action: 'rode a bicycle',
    unit: 'mile',
    micromortsPerUnit: 2,
    description: 'Cycling on public roads.',
    source: ILLUSTRATIVE_SOURCE,
  },
  {
    action: 'drove a car',
    unit: 'mile',
    micromortsPerUnit: 0.5,
    description: 'Driving a passenger car.',
    source: ILLUSTRATIVE_SOURCE,
  },
  {
    action: 'climbed stairs',
    unit: 'floor',
    micromortsPerUnit: 0.25,
    description: 'Taking the stairs instead of the elevator.',
    source: ILLUSTRATIVE_SOURCE,
  },
  {
    action: 'rode a shark',
    unit: 'minute',
    micromortsPerUnit: 1500,
    description: 'Riding a shark. Strongly discouraged.',
    source: ILLUSTRATIVE_SOURCE,
  },
  {
    action: 'jaywalked',
    unit: 'quantity',
    micromortsPerUnit: 3,
    description: 'Crossing a road outside a designated crossing, counted per crossing.',
    source: ILLUSTRATIVE_SOURCE,
  },
];

/**
 * Normalizes an action name for matching: trims, lowercases and collapses
 * internal whitespace, so "Walked  on Sidewalk " matches "walked on sidewalk".
 */
export function normalizeActionName(action: string): string {
  return action.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds a lookup catalog from definitions. Throws on invalid configuration so
 * that a bad catalog fails at startup rather than during a request.
 */
export function createRiskCatalog(definitions: readonly RiskDefinition[]): RiskCatalog {
  const catalog = new Map<string, RiskDefinition>();

  for (const definition of definitions) {
    const key = normalizeActionName(definition.action);

    if (key.length === 0) {
      throw new Error('Risk definition has an empty action name');
    }
    if (catalog.has(key)) {
      throw new Error(`Duplicate risk definition for action "${key}"`);
    }
    const rate = definition.micromortsPerUnit;
    if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_MICROMORTS_PER_UNIT) {
      throw new Error(
        `Invalid micromortsPerUnit for action "${key}": must be > 0 and <= ${String(MAX_MICROMORTS_PER_UNIT)}`,
      );
    }

    catalog.set(key, definition);
  }

  return catalog;
}
