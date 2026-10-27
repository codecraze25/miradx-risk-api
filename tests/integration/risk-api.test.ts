import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  MAX_ACTION_LENGTH,
  MAX_ACTIONS,
  MAX_COMMUTER_ID_LENGTH,
  MAX_QUANTITY,
} from '../../src/schemas/risk.schema.js';
import { action, testCatalog, type TestAction } from '../fixtures.js';

const PATH = '/api/v1/risk/calculate';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: { path: string; message: string; reason?: string }[];
    requestId: string;
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  app = buildApp({ catalog: testCatalog });
  // Test-only route used to prove that unexpected errors are not leaked.
  app.get('/__test__/boom', () => {
    throw new Error('connection string postgres://admin:s3cret@db/internal');
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function post(body: unknown): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: PATH, payload: body as object });
}

function requestWith(actions: unknown[], commuterId: unknown = 'COM-123'): unknown {
  return { commuterId, actions };
}

function errorOf(response: LightMyRequestResponse): ErrorBody['error'] {
  return response.json<ErrorBody>().error;
}

/** Asserts a 400 with exactly one issue, at the expected path. */
async function expectValidationError(
  body: unknown,
  expectedPath: string,
  expectedMessage?: RegExp,
): Promise<void> {
  const response = await post(body);
  expect(response.statusCode).toBe(400);
  const error = errorOf(response);
  expect(error.code).toBe('VALIDATION_ERROR');
  expect(error.details.map((d) => d.path)).toEqual([expectedPath]);
  expect(error.message).toBe(error.details[0]?.message);
  if (expectedMessage !== undefined) {
    expect(error.message).toMatch(expectedMessage);
  }
}

describe(`POST ${PATH} — success`, () => {
  it('returns 200 with the documented response contract for the brief’s sample request', async () => {
    const response = await post(
      requestWith([
        action({ timestamp: '2022-01-01 10:05:11', action: 'walked on sidewalk', quantity: 0.4 }),
        action({
          timestamp: '2022-01-01 10:30:09',
          action: 'rode a shark',
          unit: 'minute',
          quantity: 3,
        }),
      ]),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['cache-control']).toBe('no-store');
    // 0.4 mi × 10 + 3 min × 1000 with the test catalog. Exact keys only.
    expect(response.json()).toStrictEqual({ commuterId: 'COM-123', risk: 3004 });
  });

  it('calculates a single activity', async () => {
    const response = await post(requestWith([action({ quantity: 2 })]));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ commuterId: 'COM-123', risk: 20 });
  });

  it('sums all four units at different times on the same day', async () => {
    const actions: TestAction[] = [
      action({ timestamp: '2022-01-01 00:00:00', quantity: 1.5 }), // 15
      action({
        timestamp: '2022-01-01 08:00:00',
        action: 'climbed stairs',
        unit: 'floor',
        quantity: 3,
      }), // 6
      action({
        timestamp: '2022-01-01 12:00:00',
        action: 'rode a shark',
        unit: 'minute',
        quantity: 0.5,
      }), // 500
      action({
        timestamp: '2022-01-01 23:59:59',
        action: 'ate a pufferfish',
        unit: 'quantity',
        quantity: 1,
      }), // 50
    ];

    const response = await post(requestWith(actions));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ commuterId: 'COM-123', risk: 571 });
  });

  it('echoes a safe caller-supplied request ID and generates one otherwise', async () => {
    const withId = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-request-id': 'trace-abc_123' },
      payload: requestWith([action()]) as object,
    });
    expect(withId.headers['x-request-id']).toBe('trace-abc_123');

    const unsafeId = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-request-id': 'bad id\nwith newline' },
      payload: requestWith([action()]) as object,
    });
    expect(unsafeId.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe(`POST ${PATH} — request validation (400)`, () => {
  it('rejects a missing commuterId', async () => {
    await expectValidationError({ actions: [action()] }, 'commuterId');
  });

  it('rejects a blank commuterId', async () => {
    await expectValidationError(requestWith([action()], '   '), 'commuterId', /non-empty/);
  });

  it('rejects a non-array actions field', async () => {
    await expectValidationError({ commuterId: 'COM-123', actions: 'walk' }, 'actions');
  });

  it('rejects an empty actions array', async () => {
    await expectValidationError(requestWith([]), 'actions', /At least one action/);
  });

  it.each(['timestamp', 'action', 'unit', 'quantity'] as const)(
    'rejects an action missing "%s"',
    async (field) => {
      const incomplete = Object.fromEntries(
        Object.entries(action()).filter(([key]) => key !== field),
      );
      await expectValidationError(requestWith([incomplete]), `actions[0].${field}`);
    },
  );

  it('rejects a timestamp in the wrong format', async () => {
    await expectValidationError(
      requestWith([action({ timestamp: '2022-01-01T10:05:11Z' })]),
      'actions[0].timestamp',
      /format/,
    );
  });

  it('rejects an impossible calendar date', async () => {
    await expectValidationError(
      requestWith([action({ timestamp: '2022-02-30 10:05:11' })]),
      'actions[0].timestamp',
      /valid calendar date/,
    );
  });

  it('rejects timestamps on different calendar days with the documented message', async () => {
    const response = await post(
      requestWith([
        action({ timestamp: '2022-01-01 23:59:59' }),
        action({ timestamp: '2022-01-02 00:00:00' }),
      ]),
    );

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'All action timestamps must be on the same day',
      details: [
        { path: 'actions[1].timestamp', message: 'All action timestamps must be on the same day' },
      ],
    });
  });

  it('rejects an unsupported unit', async () => {
    await expectValidationError(
      requestWith([action({ unit: 'kilometer' })]),
      'actions[0].unit',
      /mile, floor, minute, quantity/,
    );
  });

  it.each([
    ['negative', -1],
    ['zero', 0],
  ])('rejects a %s quantity', async (_label, quantity) => {
    await expectValidationError(
      requestWith([action({ quantity })]),
      'actions[0].quantity',
      /greater than zero/,
    );
  });

  it.each([
    ['a numeric string', '3'],
    ['null', null],
    ['a boolean', true],
  ])('rejects a quantity that is %s', async (_label, quantity) => {
    await expectValidationError(
      requestWith([{ ...action(), quantity }]),
      'actions[0].quantity',
      /^Quantity must be a number$/,
    );
  });

  // Sent as raw text: JSON.stringify would turn Infinity into null.
  it.each(['1e400', '-1e400'])('rejects a quantity of %s that overflows to infinity', async (q) => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: `{"commuterId":"COM-123","actions":[{"timestamp":"2022-01-01 10:05:11","action":"walked on sidewalk","unit":"mile","quantity":${q}}]}`,
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Quantity must be a finite number',
      details: [{ path: 'actions[0].quantity', message: 'Quantity must be a finite number' }],
    });
  });

  it('rejects an empty action string', async () => {
    await expectValidationError(
      requestWith([action({ action: '' })]),
      'actions[0].action',
      /non-empty/,
    );
  });

  it('rejects unknown fields rather than silently ignoring them', async () => {
    await expectValidationError(
      { ...(requestWith([action()]) as object), risk: 0 },
      '',
      /Unrecognized key/,
    );
  });

  // Raw JSON text so that `null` and primitives reach the handler exactly as a client sends them.
  it.each([
    ['null', 'null'],
    ['a string', '"COM-123"'],
    ['a number', '42'],
    ['a boolean', 'true'],
    ['an array', JSON.stringify([action()])],
  ])('rejects a JSON body that is %s with 400, not 500', async (_label, payload) => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: '', message: expect.stringMatching(/expected object/) as unknown }],
    });
  });

  it.each([
    ['null', null],
    ['a string', 'walk'],
    ['an object', { length: 1 }],
  ])('rejects an actions field that is %s', async (_label, actions) => {
    await expectValidationError({ commuterId: 'COM-123', actions }, 'actions', /expected array/);
  });

  it('reports all validation problems at once', async () => {
    const response = await post(requestWith([action({ unit: 'parsec', quantity: -2 })], ''));

    expect(response.statusCode).toBe(400);
    const error = errorOf(response);
    expect(error.message).toBe('Request body failed validation (3 issues)');
    expect(error.details.map((d) => d.path).sort()).toEqual([
      'actions[0].quantity',
      'actions[0].unit',
      'commuterId',
    ]);
  });

  it('still checks the same-day rule when other fields are invalid', async () => {
    const response = await post(
      requestWith([action({ unit: 'parsec' }), action({ timestamp: '2022-01-02 09:00:00' })]),
    );

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).details.map((d) => d.path)).toEqual([
      'actions[0].unit',
      'actions[1].timestamp',
    ]);
  });

  it('rejects a request with no body', async () => {
    const response = await app.inject({ method: 'POST', url: PATH });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'MALFORMED_JSON',
      message: 'Request body must not be empty',
    });
  });
});

describe(`POST ${PATH} — size limits`, () => {
  it('accepts values exactly at each limit', async () => {
    const actions = Array.from({ length: MAX_ACTIONS }, () =>
      action({ action: 'climbed stairs', unit: 'floor', quantity: 1 }),
    );
    actions[0] = action({ action: 'climbed stairs', unit: 'floor', quantity: MAX_QUANTITY });

    const response = await post(requestWith(actions, 'C'.repeat(MAX_COMMUTER_ID_LENGTH)));

    expect(response.statusCode).toBe(200);
    expect(response.json<{ risk: number }>().risk).toBe((MAX_QUANTITY + MAX_ACTIONS - 1) * 2);
  });

  it('rejects too many actions', async () => {
    const actions = Array.from({ length: MAX_ACTIONS + 1 }, () => action());
    await expectValidationError(requestWith(actions), 'actions', /At most 1000 actions/);
  });

  it('rejects a quantity above the maximum', async () => {
    await expectValidationError(
      requestWith([action({ quantity: MAX_QUANTITY + 1 })]),
      'actions[0].quantity',
      /at most/,
    );
  });

  it('rejects an over-long action', async () => {
    await expectValidationError(
      requestWith([action({ action: 'a'.repeat(MAX_ACTION_LENGTH + 1) })]),
      'actions[0].action',
      /at most 200/,
    );
  });

  it('rejects an over-long commuterId', async () => {
    await expectValidationError(
      requestWith([action()], 'C'.repeat(MAX_COMMUTER_ID_LENGTH + 1)),
      'commuterId',
      /at most 128/,
    );
  });
});

describe(`POST ${PATH} — transport errors`, () => {
  it('rejects malformed JSON without echoing parser internals', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{"commuterId": "COM-123", "actions": [',
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'MALFORMED_JSON',
      message: 'Request body is not valid JSON',
      details: [],
    });
  });

  it('rejects an empty JSON body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe('MALFORMED_JSON');
  });

  it('rejects prototype-poisoning payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: '{"commuterId":"COM-123","actions":[],"__proto__":{"isAdmin":true}}',
    });

    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe('MALFORMED_JSON');
  });

  it('rejects non-JSON content types with 415', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });

    expect(response.statusCode).toBe(415);
    expect(errorOf(response).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects oversized bodies with 413', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ commuterId: 'x'.repeat(300 * 1024), actions: [] }),
    });

    expect(response.statusCode).toBe(413);
    expect(errorOf(response).code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe(`POST ${PATH} — unpriceable activities (422)`, () => {
  it('rejects an unknown activity instead of assigning zero risk', async () => {
    const response = await post(
      requestWith([action(), action({ action: 'juggled chainsaws', unit: 'minute' })]),
    );

    expect(response.statusCode).toBe(422);
    expect(errorOf(response)).toMatchObject({
      code: 'UNSUPPORTED_ACTIVITY',
      details: [{ path: 'actions[1]', reason: 'UNKNOWN_ACTIVITY' }],
    });
  });

  it('rejects a known activity reported in the wrong unit', async () => {
    const response = await post(requestWith([action({ action: 'rode a shark', unit: 'mile' })]));

    expect(response.statusCode).toBe(422);
    expect(errorOf(response)).toMatchObject({
      code: 'UNSUPPORTED_ACTIVITY',
      details: [
        {
          path: 'actions[0]',
          reason: 'UNIT_MISMATCH',
          message: 'This action is measured in "minute", not "mile"',
        },
      ],
    });
  });

  it('does not echo the submitted action text back to the client', async () => {
    const response = await post(requestWith([action({ action: 'patient Jane Doe biopsy' })]));

    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('Jane Doe');
  });
});

describe('error handling', () => {
  it('returns a generic 500 without leaking internal details', async () => {
    const response = await app.inject({ method: 'GET', url: '/__test__/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toStrictEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: [],
        requestId: expect.any(String) as unknown,
      },
    });
    expect(response.body).not.toMatch(/s3cret|postgres|stack|at /);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe('NOT_FOUND');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('includes the request ID in error bodies for correlation with logs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-request-id': 'corr-42' },
      payload: requestWith([]) as object,
    });

    expect(errorOf(response).requestId).toBe('corr-42');
    expect(response.headers['x-request-id']).toBe('corr-42');
  });
});

describe('logging', () => {
  it('logs request correlation data but not commuter IDs or activity text', async () => {
    const lines: string[] = [];
    const loggedApp = buildApp({
      catalog: testCatalog,
      logger: { level: 'info', stream: { write: (line: string) => lines.push(line) } },
    });
    await loggedApp.ready();

    await loggedApp.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-request-id': 'log-check-1' },
      payload: requestWith([action({ action: 'Walked on sidewalk' })], 'COM-SENSITIVE-9') as object,
    });
    await loggedApp.inject({
      method: 'POST',
      url: PATH,
      payload: requestWith(
        [action({ action: 'confidential-activity' })],
        'COM-SENSITIVE-9',
      ) as object,
    });
    await loggedApp.close();

    const output = lines.join('');
    expect(output).toContain('log-check-1');
    expect(output).toContain('"actionCount":1');
    expect(output).toContain('"errorCode":"UNSUPPORTED_ACTIVITY"');
    expect(output).not.toContain('COM-SENSITIVE-9');
    expect(output).not.toMatch(/sidewalk|confidential-activity/i);
  });
});

describe('supporting endpoints', () => {
  it('serves an OpenAPI document describing the calculate endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });

    expect(response.statusCode).toBe(200);
    const doc = response.json<{
      openapi: string;
      paths: Record<string, { post?: { requestBody: unknown } }>;
    }>();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths[PATH]?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['commuterId', 'actions'],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toStrictEqual({ status: 'ok' });
  });
});
