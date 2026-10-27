import { calculateRisk } from '../domain/risk-calculator.js';
import { ApplicationError } from '../errors/application-error.js';
import type { RiskRequest } from '../schemas/risk.schema.js';
import type { RiskCatalog, RiskResponse } from '../types/risk.types.js';

/**
 * Application service: runs the pure calculator against the configured
 * catalog and translates domain outcomes into the API contract.
 */
export function calculateCommuterRisk(request: RiskRequest, catalog: RiskCatalog): RiskResponse {
  const result = calculateRisk(request.actions, catalog);

  if (!result.ok) {
    throw new ApplicationError(
      422,
      'UNSUPPORTED_ACTIVITY',
      'One or more actions cannot be priced with the configured risk catalog',
      result.issues.map((issue) => ({
        path: `actions[${String(issue.index)}]`,
        reason: issue.reason,
        message: issue.message,
      })),
    );
  }

  return { commuterId: request.commuterId, risk: result.risk };
}
