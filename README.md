# MiraDx Commuter Risk API

A small, stateless HTTP API that calculates the total risk of one day of a commuter's activities, measured in **micromorts** (a one-in-a-million chance of death).

It accepts a JSON `POST`, validates the input strictly, prices each activity from a configurable risk catalog, and returns the total.

> **The risk rates in this project are illustrative and fictional.** The brief does not supply real rates or a formula, so the default catalog exists only to exercise the API. It should not be used for any real-world decision.

## Technology stack

| Concern      | Choice                                                         |
| ------------ | -------------------------------------------------------------- |
| Runtime      | Node.js (≥ 20.19, developed on 22), ESM                        |
| Language     | TypeScript 5.9, `strict` + extra checks                        |
| HTTP         | Fastify 5                                                      |
| Validation   | Zod 4                                                          |
| Logging      | Pino (Fastify's built-in logger), JSON                         |
| API docs     | OpenAPI 3.1, generated from the Zod schema                     |
| Tests        | Vitest 3 (unit + `fastify.inject` integration)                 |
| Code quality | ESLint 9 (`typescript-eslint` strict, type-checked) + Prettier |

Runtime dependencies: `fastify` and `zod` only.

## Prerequisites

- Node.js **20.19 or newer** (an `.nvmrc` pins 22)
- npm 10+

## Installation

```bash
npm install
```

## Running the API

```bash
npm run dev        # watch mode via tsx, for development
# or
npm run build      # compile to dist/
npm start          # run the compiled server
```

The server listens on `http://127.0.0.1:3000` by default.

| Variable    | Default     | Purpose                                                   |
| ----------- | ----------- | --------------------------------------------------------- |
| `PORT`      | `3000`      | Listen port                                               |
| `HOST`      | `127.0.0.1` | Listen address. Use `0.0.0.0` inside a container.         |
| `LOG_LEVEL` | `info`      | Pino level (`fatal`, `error`, `warn`, `info`, `debug`, …) |

## Tests and quality checks

```bash
npm test            # unit + integration tests
npm run typecheck   # tsc --noEmit over src and tests
npm run lint        # ESLint
npm run format:check
```

Integration tests use `fastify.inject`, so they exercise the full HTTP pipeline (parsing, validation, error handling, headers) without opening a port. They run against a fixed test catalog, so expected totals do not change when the illustrative default rates are edited.

## API

### `POST /api/v1/risk/calculate`

Request (`Content-Type: application/json`):

```json
{
  "commuterId": "COM-123",
  "actions": [
    {
      "timestamp": "2022-01-01 10:05:11",
      "action": "walked on sidewalk",
      "unit": "mile",
      "quantity": 0.4
    },
    {
      "timestamp": "2022-01-01 10:30:09",
      "action": "rode a shark",
      "unit": "minute",
      "quantity": 3
    }
  ]
}
```

Example:

```bash
curl -s -X POST http://127.0.0.1:3000/api/v1/risk/calculate \
  -H 'Content-Type: application/json' \
  -d '{"commuterId":"COM-123","actions":[
        {"timestamp":"2022-01-01 10:05:11","action":"walked on sidewalk","unit":"mile","quantity":0.4},
        {"timestamp":"2022-01-01 10:30:09","action":"rode a shark","unit":"minute","quantity":3}]}'
```

Successful response — `200 OK`:

```json
{ "commuterId": "COM-123", "risk": 4500.4 }
```

With the default catalog this is `0.4 × 1 + 3 × 1500 = 4500.4`. The brief's sample shows `5500`; that number is not reproduced on purpose, because the brief gives no rates from which to derive it (see [Risk catalog](#risk-catalog-and-assumptions)).

Every response carries an `x-request-id` header. A caller-supplied `x-request-id` is reused if it matches `[A-Za-z0-9._-]{1,128}`; otherwise a UUID is generated. All responses are sent with `Cache-Control: no-store`.

### Validation error example — `400 Bad Request`

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "All action timestamps must be on the same day",
    "details": [
      { "path": "actions[1].timestamp", "message": "All action timestamps must be on the same day" }
    ],
    "requestId": "779ba60d-3ff7-461b-85a1-db9e6fb8d5b3"
  }
}
```

All validation problems are reported together, including the same-day check when other fields are also invalid. When there is more than one, `message` reads `Request body failed validation (N issues)` and `details` lists each one.

### Status codes

| Status | `error.code`             | When                                                                                    |
| ------ | ------------------------ | --------------------------------------------------------------------------------------- |
| 200    | —                        | Risk calculated                                                                         |
| 400    | `VALIDATION_ERROR`       | Body is valid JSON but breaks a rule below                                              |
| 400    | `MALFORMED_JSON`         | Body is missing or empty, is not valid JSON, or contains `__proto__`/`constructor` keys |
| 413    | `PAYLOAD_TOO_LARGE`      | Body over 256 KiB                                                                       |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` is not `application/json`                                                |
| 422    | `UNSUPPORTED_ACTIVITY`   | Input is valid but an action has no configured rate, or uses the wrong unit             |
| 4xx    | `BAD_REQUEST`            | Any other malformed request rejected by the HTTP layer                                  |
| 404    | `NOT_FOUND`              | Unknown route (including other HTTP methods on the calculate route)                     |
| 500    | `INTERNAL_ERROR`         | Unexpected failure. Generic message only; details go to the server log.                 |

`422` example (`details[].reason` is `UNKNOWN_ACTIVITY` or `UNIT_MISMATCH`):

```json
{
  "error": {
    "code": "UNSUPPORTED_ACTIVITY",
    "message": "One or more actions cannot be priced with the configured risk catalog",
    "details": [
      {
        "path": "actions[0]",
        "reason": "UNIT_MISMATCH",
        "message": "This action is measured in \"minute\", not \"mile\""
      }
    ],
    "requestId": "…"
  }
}
```

### Other endpoints

- `GET /openapi.json` — OpenAPI 3.1 document. The request body schema is generated from the same Zod schema used for validation, so field types, required keys, enums, lengths and numeric bounds stay in sync. Rules JSON Schema cannot express (non-blank strings, real calendar dates, same-day) are described in the operation text instead.
- `GET /health` — liveness check, returns `{ "status": "ok" }`.

### Validation rules

| Field                 | Rule                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| body                  | JSON object; unknown keys are rejected                                                             |
| `commuterId`          | string, not blank, ≤ 128 chars; returned unchanged                                                 |
| `actions`             | array of 1–1000 items                                                                              |
| `actions[].timestamp` | `YYYY-MM-DD HH:mm:ss`, a real calendar date/time (leap years checked; no `24:00`, no leap seconds) |
| all timestamps        | same `YYYY-MM-DD` date                                                                             |
| `actions[].action`    | string, not blank, ≤ 200 chars                                                                     |
| `actions[].unit`      | one of `mile`, `floor`, `minute`, `quantity`                                                       |
| `actions[].quantity`  | JSON number, > 0 and ≤ 1,000,000 (numeric strings are not coerced)                                 |
| each action           | unknown keys are rejected                                                                          |

## Risk calculation

```
activityRisk = quantity × micromortsPerUnit
totalRisk    = Σ activityRisk
```

- The calculator (`src/domain/risk-calculator.ts`) is a pure function of the activities and the catalog.
- Action names are matched after trimming, lowercasing and collapsing whitespace, so `"Rode  a Shark"` matches `"rode a shark"`.
- If any action is unknown or uses a unit other than the one configured for it, the request fails with `422` and every problem is listed. No partial total is returned and unknown actions are never treated as zero risk: a silent zero would understate risk, which is the worse failure in a safety context.
- **Rounding:** values are summed at full double precision. Only the final total is rounded, to 6 decimal places, to remove binary floating-point noise (e.g. `0.1 + 0.2` → `0.3`). With the input bounds above the total always stays finite. A side effect: a contribution below 0.0000005 micromorts (e.g. `quantity: 1e-9`) rounds to `0`.
- Micromorts are summed linearly. That is the usual approximation for small risks, but it is not a probability model: totals above 1,000,000 are possible and are not capped.

## Risk catalog and assumptions

The catalog lives in `src/domain/risk-rates.ts`. Each definition has:

```ts
{ action: 'rode a shark', unit: 'minute', micromortsPerUnit: 1500, description: '…', source: '…' }
```

Default (all values **illustrative, fictional, not scientifically validated**):

| Action             | Unit       | Micromorts per unit |
| ------------------ | ---------- | ------------------- |
| walked on sidewalk | `mile`     | 1                   |
| rode a bicycle     | `mile`     | 2                   |
| drove a car        | `mile`     | 0.5                 |
| climbed stairs     | `floor`    | 0.25                |
| rode a shark       | `minute`   | 1500                |
| jaywalked          | `quantity` | 3                   |

To add or change an activity, edit `DEFAULT_RISK_DEFINITIONS`. The catalog is checked at startup: duplicate names (after normalisation), empty names, and rates that are not in `(0, 1_000_000]` stop the server from starting. `buildApp({ catalog })` accepts a different catalog, which is how the tests stay independent of these values.

Assumptions made where the brief is silent:

1. **Timestamps** have no offset, so they are treated as the commuter's local wall-clock time. They are never converted to UTC. "Same day" means the same `YYYY-MM-DD` as written. Only the brief's format is accepted; ISO-8601 variants (`T`, `Z`, offsets) are rejected rather than half-supported.
2. **Empty `actions`** is rejected (`400`). A response of `risk: 0` for a request that described nothing could be read as "this day was safe". Changing this is a one-line edit (`.min(1)` in `src/schemas/risk.schema.ts`).
3. **"Action can be any string"** is honoured at the validation layer: any non-blank string is a valid action. Whether it can be _priced_ is a separate check against the catalog (`422` when it cannot).
4. **Quantities may be fractional for every unit**, including `floor` and `quantity` (e.g. `2.5` floors). The brief only lists the units, so nothing forces them to be whole numbers.
5. **One unit per activity.** Unit conversion (e.g. minutes of walking → miles) is not attempted because it would need data the brief doesn't provide.
6. **Size limits** (256 KiB body, 1000 actions, 200-char action, 128-char ID, quantity ≤ 1,000,000) are defensive bounds, not business rules, and can be raised. The body limit is checked first, so a request with 1000 actions that each use the maximum field lengths would be rejected with `413` before the action-count rule applies.

## Design decisions and trade-offs

```
src/
  app.ts                 Fastify setup: request IDs, error handler, 404, routes (buildApp factory)
  server.ts              Process entry point: env config, listen, graceful shutdown
  openapi.ts             OpenAPI document built from the Zod schema
  routes/risk.routes.ts  HTTP layer: parse body with Zod, call service, reply
  services/risk.service.ts  Runs the calculator, maps domain issues to a 422 ApplicationError
  domain/risk-calculator.ts Pure calculation + rounding
  domain/risk-rates.ts      Catalog data, name normalisation, catalog checks
  schemas/risk.schema.ts    Request schema and timestamp rules
  errors/application-error.ts Client-safe error type and error body shape
  types/risk.types.ts       Shared domain types
```

- **Layering without ceremony.** HTTP, validation, application logic and the pure calculator are separate files. There are no controller classes, repositories or DI containers; the only injected dependency is the catalog, because it is the one thing tests and future callers need to swap.
- **Zod in the handler rather than Fastify's JSON-schema validator.** It gives one source of truth for types, validation and OpenAPI, and supports the cross-field same-day rule and the calendar check. The cost is that Fastify's AJV fast path is not used, which doesn't matter at this scale.
- **Validation (400) vs. pricing (422).** A request can be well-formed but not priceable with the current catalog. Keeping these separate tells the client whether to fix the request or whether the server lacks data.
- **Errors are allow-listed.** Only `ApplicationError`s (and known Fastify parser errors, re-worded) reach the client. Everything else becomes a generic 500, and the full error with stack goes to the log.
- **Logging.** Fastify logs method, URL, status, latency, request ID and the client's IP address and port per request. The handler adds only the action count. Request bodies, commuter IDs and action text are never logged, and error details reference fields by path (`actions[1]`) rather than echoing values. A test checks this.
- **Stateless.** No database: nothing in the brief needs persistence, and the catalog is configuration.

## Known limitations

- Risk rates are placeholders. The API is only as meaningful as its catalog.
- The catalog is compiled in; changing rates means a redeploy.
- No authentication, authorisation, rate limiting or TLS. The server binds to localhost by default.
- No audit trail of calculations; logs are operational, not an audit record.
- Wrong HTTP methods on the calculate route return `404`, not `405`.
- Not HIPAA-assessed or production-certified. It follows sensible defaults (minimal logging, no data echoing, no stack traces), but it has not been through a compliance review.

## Possible production improvements

Not implemented; listed in rough priority order.

1. Source rates from a reviewed, versioned dataset with citations, and return the catalog version with each result so a number can be traced back to its inputs.
2. Authentication (e.g. OAuth2/JWT via an API gateway) and per-client rate limiting (`@fastify/rate-limit`).
3. An append-only audit log of who calculated what, with which catalog version, stored separately from operational logs.
4. Optional per-action breakdown in the response, and explicit timezone support (accept an offset or an IANA zone with the request).
5. Unit conversion where it is scientifically meaningful.
6. Container image, health/readiness probes wired to an orchestrator, metrics (request rate, latency, error codes) and tracing (OpenTelemetry).
7. Swagger UI for the existing OpenAPI document, and contract tests against it.
8. CI pipeline running `typecheck`, `lint`, `test` and `npm audit` on every change.
