import { z } from 'zod';
import { ERROR_CODES } from './errors/application-error.js';
import { riskRequestSchema } from './schemas/risk.schema.js';
import { RISK_CALCULATE_PATH } from './routes/risk.routes.js';
import { UNITS } from './types/risk.types.js';

/**
 * OpenAPI 3.1 description of the API, served at GET /openapi.json.
 * The request schema is generated from the same Zod schema used for
 * validation, so documentation and behavior cannot drift apart.
 * Cross-field rules (same calendar day) are described in prose because JSON
 * Schema cannot express them.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const { $schema: _ignored, ...requestSchema } = z.toJSONSchema(riskRequestSchema, {
    io: 'input',
  });

  const errorSchema = {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'details', 'requestId'],
        properties: {
          code: {
            type: 'string',
            enum: ERROR_CODES,
          },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: {
              type: 'object',
              required: ['path', 'message'],
              properties: {
                path: { type: 'string', example: 'actions[1].unit' },
                message: { type: 'string' },
                reason: { type: 'string', enum: ['UNKNOWN_ACTIVITY', 'UNIT_MISMATCH'] },
              },
            },
          },
          requestId: { type: 'string' },
        },
      },
    },
  };

  const errorResponse = (description: string): Record<string, unknown> => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'MiraDx Commuter Risk API',
      version: '1.0.0',
      description:
        'Calculates the total risk of a single day of activities, in micromorts. ' +
        'Risk rates are illustrative placeholders, not validated scientific figures.',
    },
    paths: {
      [RISK_CALCULATE_PATH]: {
        post: {
          summary: 'Calculate the total micromort risk of a set of activities',
          description:
            'Every timestamp must use the format "YYYY-MM-DD HH:mm:ss" and all timestamps ' +
            'must share the same calendar date. Timestamps are interpreted as local ' +
            'wall-clock time; no timezone conversion is applied. ' +
            `Allowed units: ${UNITS.join(', ')}.`,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: requestSchema } },
          },
          responses: {
            '200': {
              description: 'Total risk calculated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['commuterId', 'risk'],
                    properties: {
                      commuterId: { type: 'string' },
                      risk: { type: 'number', description: 'Total micromorts, rounded to 6 dp' },
                    },
                  },
                },
              },
            },
            '400': errorResponse('Malformed JSON or request validation failure'),
            '413': errorResponse('Request body too large'),
            '415': errorResponse('Content-Type is not application/json'),
            '422': errorResponse('An action has no configured risk rate or uses the wrong unit'),
            '500': errorResponse('Unexpected server error (no internal details are returned)'),
          },
        },
      },
      '/health': {
        get: {
          summary: 'Liveness check',
          responses: { '200': { description: 'Service is running' } },
        },
      },
    },
    components: { schemas: { ErrorResponse: errorSchema } },
  };
}
