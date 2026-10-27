/** Units accepted by the API, exactly as listed in the assessment. */
export const UNITS = ['mile', 'floor', 'minute', 'quantity'] as const;

export type Unit = (typeof UNITS)[number];

/** One activity as it is passed to the calculator (already validated). */
export interface Activity {
  readonly action: string;
  readonly unit: Unit;
  readonly quantity: number;
}

/** A configured risk rate for one activity, measured in one unit. */
export interface RiskDefinition {
  /** Human-readable activity name; matched case- and whitespace-insensitively. */
  readonly action: string;
  readonly unit: Unit;
  /** Micromorts incurred per single unit of the activity. */
  readonly micromortsPerUnit: number;
  readonly description?: string;
  /** Where the rate came from. Required so every number is traceable. */
  readonly source: string;
}

/** Lookup structure built once from a list of definitions. Keyed by normalized action name. */
export type RiskCatalog = ReadonlyMap<string, RiskDefinition>;

export type ActivityIssueReason = 'UNKNOWN_ACTIVITY' | 'UNIT_MISMATCH';

/** A reason why a syntactically valid activity could not be priced. */
export interface ActivityIssue {
  readonly index: number;
  readonly reason: ActivityIssueReason;
  readonly message: string;
}

export type RiskCalculationResult =
  | { readonly ok: true; readonly risk: number }
  | { readonly ok: false; readonly issues: readonly ActivityIssue[] };

export interface RiskResponse {
  readonly commuterId: string;
  readonly risk: number;
}
