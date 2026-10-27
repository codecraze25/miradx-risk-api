import type { ActivityIssueReason } from '../types/risk.types.js';

/** Every error code the API can return. Single source for the type and the OpenAPI document. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'MALFORMED_JSON',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_ACTIVITY',
  'NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDetail {
  /** Location of the problem in the request body, e.g. "actions[1].unit". Empty for the whole body. */
  readonly path: string;
  readonly message: string;
  /** Machine-readable sub-reason, where one exists. */
  readonly reason?: ActivityIssueReason;
}

/**
 * An error whose message and details are safe to return to the client.
 * Anything that is not an ApplicationError is treated as unexpected and is
 * reported to the client only as a generic 500.
 */
export class ApplicationError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details: readonly ErrorDetail[] = [],
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details: readonly ErrorDetail[];
    readonly requestId: string;
  };
}
