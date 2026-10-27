import type { FastifyPluginCallback } from 'fastify';
import type { z } from 'zod';
import { ApplicationError, type ErrorDetail } from '../errors/application-error.js';
import { riskRequestSchema } from '../schemas/risk.schema.js';
import { calculateCommuterRisk } from '../services/risk.service.js';
import type { RiskCatalog, RiskResponse } from '../types/risk.types.js';

export const RISK_CALCULATE_PATH = '/api/v1/risk/calculate';

/** Formats a Zod issue path as "actions[1].unit". */
function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') {
      return `${formatted}[${String(segment)}]`;
    }
    const key = String(segment);
    return formatted === '' ? key : `${formatted}.${key}`;
  }, '');
}

function toValidationError(error: z.ZodError): ApplicationError {
  const details: ErrorDetail[] = error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
  const [first] = details;
  const message =
    details.length === 1 && first !== undefined
      ? first.message
      : `Request body failed validation (${String(details.length)} issues)`;
  return new ApplicationError(400, 'VALIDATION_ERROR', message, details);
}

export interface RiskRoutesOptions {
  readonly catalog: RiskCatalog;
}

export const riskRoutes: FastifyPluginCallback<RiskRoutesOptions> = (app, options, done) => {
  app.post(RISK_CALCULATE_PATH, (request): RiskResponse => {
    if (request.body === undefined) {
      throw new ApplicationError(400, 'MALFORMED_JSON', 'Request body must not be empty');
    }
    const parsed = riskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw toValidationError(parsed.error);
    }

    const response = calculateCommuterRisk(parsed.data, options.catalog);

    // Log shape, not content: no commuter identifier or activity text.
    request.log.info({ actionCount: parsed.data.actions.length }, 'risk calculated');

    return response;
  });
  done();
};
