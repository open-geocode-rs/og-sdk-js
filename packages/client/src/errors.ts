import type { components } from "./schema.gen.ts";

/** An RFC 9457 problem document, as og returns on every error. */
export type Problem = components["schemas"]["Problem"];

/**
 * Base class of every error the client throws.
 * `status` is absent when og never answered (connection failure, timeout, abort).
 */
export class OgError extends Error {
  /** HTTP status, when og answered. */
  readonly status: number | undefined;
  /** og's stable error code. Branch on this, never on `message`. */
  readonly code: string | undefined;
  /** The full problem document, when og sent one. */
  readonly problem: Problem | undefined;
  /** The ID og logged the request under. Include it in bug reports. */
  readonly requestId: string | undefined;
  /** Response headers, when og answered. */
  readonly headers: Headers | undefined;

  constructor(
    message: string,
    init: {
      status?: number;
      problem?: Problem;
      requestId?: string;
      headers?: Headers;
      cause?: unknown;
    } = {},
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.code = init.problem?.error_code;
    this.problem = init.problem;
    this.requestId = init.requestId;
    this.headers = init.headers;
  }

  /** Builds the error subclass that matches an HTTP status. */
  static fromResponse(status: number, problem: Problem | undefined, headers: Headers): OgError {
    const message = problem?.detail ?? problem?.title ?? `og answered ${status}`;
    const requestId = headers.get("x-request-id") ?? problem?.request_id ?? undefined;
    const init = {
      status,
      headers,
      ...(problem === undefined ? {} : { problem }),
      ...(requestId === undefined ? {} : { requestId }),
    };
    const Class = STATUS_ERRORS[status] ?? (status >= 500 ? InternalServerError : OgError);
    return new Class(message, init);
  }
}

/** 400: a parameter was missing or malformed. */
export class BadRequestError extends OgError {}
/** 401: rejected by the gateway in front of og. */
export class AuthenticationError extends OgError {}
/** 403: rejected by the gateway in front of og. */
export class PermissionDeniedError extends OgError {}
/** 404: no such job or endpoint. */
export class NotFoundError extends OgError {}
/** 409: the job is not in a state that allows this. */
export class ConflictError extends OgError {}
/** 413: the upload is larger than og accepts. */
export class PayloadTooLargeError extends OgError {}
/** 422: og understood the request but cannot process it. */
export class UnprocessableEntityError extends OgError {}
/** 429: rate limited, usually by the gateway in front of og. */
export class RateLimitError extends OgError {}
/** 500 and above: og or something in front of it failed. */
export class InternalServerError extends OgError {}
/** og could not be reached. */
export class APIConnectionError extends OgError {}
/** og did not answer within `timeout`. */
export class APIConnectionTimeoutError extends APIConnectionError {}
/** The caller aborted the request with its `signal`. */
export class APIUserAbortError extends OgError {}

const STATUS_ERRORS: Record<number, typeof OgError> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PermissionDeniedError,
  404: NotFoundError,
  409: ConflictError,
  413: PayloadTooLargeError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};
