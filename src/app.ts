import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { createRiskCatalog, DEFAULT_RISK_DEFINITIONS } from './domain/risk-rates.js';
import {
  ApplicationError,
  type ErrorCode,
  type ErrorResponseBody,
} from './errors/application-error.js';
import { buildOpenApiDocument } from './openapi.js';
import { riskRoutes } from './routes/risk.routes.js';
import type { RiskCatalog } from './types/risk.types.js';

/** Maximum accepted request body size in bytes (256 KiB). */
export const BODY_LIMIT_BYTES = 256 * 1024;

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface BuildAppOptions {
  /** Risk catalog to price activities with. Defaults to the illustrative catalog. */
  readonly catalog?: RiskCatalog;
  /** Fastify/Pino logger configuration. Defaults to disabled (useful for tests). */
  readonly logger?: FastifyServerOptions['logger'];
}

/** Reuse a caller-supplied request ID when it is safe to log; otherwise generate one. */
function generateRequestId(header: string | string[] | undefined): string {
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID();
}

/** Client-safe translation of errors raised by Fastify itself (body parsing, content type). */
interface FrameworkErrorMapping {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
}

const FRAMEWORK_ERRORS = new Map<string, FrameworkErrorMapping>([
  [
    'FST_ERR_CTP_INVALID_JSON_BODY',
    {
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'Request body is not valid JSON',
    },
  ],
  [
    'FST_ERR_CTP_EMPTY_JSON_BODY',
    {
      status: 400,
      code: 'MALFORMED_JSON',
      message: 'Request body must not be empty',
    },
  ],
  [
    'FST_ERR_CTP_BODY_TOO_LARGE',
    {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: `Request body must not exceed ${String(BODY_LIMIT_BYTES)} bytes`,
    },
  ],
  [
    'FST_ERR_CTP_INVALID_MEDIA_TYPE',
    {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type must be application/json',
    },
  ],
]);

function toApplicationError(error: FastifyError): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }
  const known = FRAMEWORK_ERRORS.get(error.code);
  if (known !== undefined) {
    return new ApplicationError(known.status, known.code, known.message);
  }
  // Any other client error raised by the framework: keep its status, but never
  // forward the framework's own message.
  const status = error.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    return new ApplicationError(status, 'BAD_REQUEST', 'The request could not be processed');
  }
  return new ApplicationError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: ApplicationError,
): FastifyReply {
  const body: ErrorResponseBody = {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: request.id,
    },
  };
  return reply.status(error.statusCode).send(body);
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const catalog = options.catalog ?? createRiskCatalog(DEFAULT_RISK_DEFINITIONS);

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (req) => generateRequestId(req.headers[REQUEST_ID_HEADER]),
  });

  // The API only speaks JSON; Fastify parses text/plain by default, so drop it
  // to make non-JSON bodies fail with 415 rather than a confusing 400.
  app.removeContentTypeParser('text/plain');

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // Responses may describe a person's activities; keep them out of shared caches.
    void reply.header('cache-control', 'no-store');
    done();
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const appError = toApplicationError(error);
    if (appError.statusCode >= 500) {
      // Full error (with stack) goes to the server log only.
      request.log.error({ err: error }, 'unhandled error');
    } else {
      request.log.info({ errorCode: appError.code }, 'request rejected');
    }
    return sendError(reply, request, appError);
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, request, new ApplicationError(404, 'NOT_FOUND', 'Route not found')),
  );

  app.get('/health', () => ({ status: 'ok' }));

  const openApiDocument = buildOpenApiDocument();
  app.get('/openapi.json', () => openApiDocument);

  app.register(riskRoutes, { catalog });

  return app;
}
