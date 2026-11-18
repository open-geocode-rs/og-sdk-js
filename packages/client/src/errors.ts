import type { components } from "./schema.gen.ts";

/** An RFC 9457 problem document, as og returns on every error. */
export type Problem = components["schemas"]["Problem"];

/** What an error is built from. */
export interface OgErrorInit {
  status?: number | undefined;
  /** The parsed error body, whatever shape the provider uses. */
  body?: unknown;
  requestId?: string | undefined;
  headers?: Headers | undefined;
  /** The provider that answered, such as `og` or `google`. */
  provider?: string | undefined;
  cause?: unknown;
}

function asProblem(body: unknown): Problem | undefined {
  return body !== null &&
    typeof body === "object" &&
    typeof (body as Problem).error_code === "string"
    ? (body as Problem)
    : undefined;
}

/**
 * Base class of every error the client throws.
 * `status` is absent when the provider never answered (connection failure, timeout, abort).
 */
export class OgError extends Error {
  /** HTTP status, when the provider answered. */
  readonly status: number | undefined;
  /** A stable error code. Branch on this, never on `message`. On a transport error it is og's own code, when og sent one. */
  readonly code: string | undefined;
  /** The full problem document, when og sent one. */
  readonly problem: Problem | undefined;
  /** The parsed error body, in the provider's own shape. */
  readonly body: unknown;
  /** The ID the provider logged the request under. Include it in bug reports. */
  readonly requestId: string | undefined;
  /** Response headers, when the provider answered. */
  readonly headers: Headers | undefined;
  /** The provider that failed, such as `og` or `google`. */
  readonly provider: string | undefined;

  constructor(message: string, init: OgErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = new.target.name;
    this.status = init.status;
    this.problem = asProblem(init.body);
    this.code = this.problem?.error_code;
    this.body = init.body;
    this.requestId = init.requestId;
    this.headers = init.headers;
    this.provider = init.provider;
  }

  /** Builds the error subclass that matches an HTTP status. */
  static fromResponse(
    status: number,
    body: unknown,
    headers: Headers,
    hints: {
      provider?: string | undefined;
      message?: string | undefined;
      requestId?: string | undefined;
    } = {},
  ): OgError {
    const problem = asProblem(body);
    const provider = hints.provider ?? "og";
    const message =
      hints.message ?? problem?.detail ?? problem?.title ?? `${provider} answered ${status}`;
    const requestId =
      hints.requestId ?? headers.get("x-request-id") ?? problem?.request_id ?? undefined;
    const Class = STATUS_ERRORS[status] ?? (status >= 500 ? InternalServerError : OgError);
    return new Class(message, { status, headers, body, provider, requestId });
  }
}

/** 400: a parameter was missing or malformed. */
export class BadRequestError extends OgError {}
/** 401: the credentials were missing or rejected. */
export class AuthenticationError extends OgError {}
/** 403: the credentials do not allow this. */
export class PermissionDeniedError extends OgError {}
/** 404: no such record, job or endpoint. */
export class NotFoundError extends OgError {}
/** 409: the job is not in a state that allows this. */
export class ConflictError extends OgError {}
/** 413: the upload or batch is larger than the provider accepts. */
export class PayloadTooLargeError extends OgError {}
/** 422: the provider understood the request but cannot process it. */
export class UnprocessableEntityError extends OgError {}
/** 429: rate limited. */
export class RateLimitError extends OgError {}
/** 500 and above: the provider or something in front of it failed. */
export class InternalServerError extends OgError {}
/** The provider could not be reached. */
export class APIConnectionError extends OgError {}
/** The provider did not answer within `timeout`. */
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

/**
 * The codes a {@link GeocoderError} carries, the same for every provider.
 *
 * - `invalid_request`: a parameter was missing or malformed.
 * - `unauthenticated`: the key or token was missing or rejected.
 * - `permission_denied`: the key does not allow this call.
 * - `not_found`: no such record, job or endpoint.
 * - `conflict`: the job is not in a state that allows this.
 * - `payload_too_large`: the upload or batch is too large.
 * - `rate_limited`: too many requests, or the quota is used up.
 * - `unsupported`: the provider has no such operation or option.
 * - `timeout`: the provider did not answer in time.
 * - `aborted`: the caller's `signal` fired.
 * - `connection`: the provider could not be reached.
 * - `unavailable`: the provider is overloaded or down for now.
 * - `provider_error`: the provider failed, or sent an answer that cannot be read.
 * - `vetoed`: a plugin refused the call.
 * - `unknown`: anything else.
 */
export type GeocoderErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "unsupported"
  | "timeout"
  | "aborted"
  | "connection"
  | "unavailable"
  | "provider_error"
  | "vetoed"
  | "unknown";

/**
 * The one error a `Geocoder` throws, whatever the provider.
 * Branch on `code`. The provider's own error, with its status, headers and body, is `cause`.
 */
export class GeocoderError extends OgError {
  declare readonly code: GeocoderErrorCode;
  /** The operation that failed, such as `geocode` or `batch.reverse`. */
  readonly operation: string | undefined;

  constructor(
    message: string,
    init: OgErrorInit & { code: GeocoderErrorCode; operation?: string | undefined },
  ) {
    super(message, init);
    Object.defineProperty(this, "code", { value: init.code, enumerable: true });
    this.operation = init.operation;
  }

  /** Whether another attempt, or another provider, could succeed where this one failed. */
  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  /** Wraps anything thrown into a `GeocoderError`. An existing one is returned as is. */
  static from(
    error: unknown,
    context: {
      provider: string;
      operation?: string | undefined;
      /** A provider's own reading of its error, used before the status. */
      code?: GeocoderErrorCode | undefined;
    },
  ): GeocoderError {
    if (error instanceof GeocoderError) return error;
    const source = error instanceof OgError ? error : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return new GeocoderError(message, {
      code: context.code ?? codeOf(error),
      operation: context.operation,
      provider: source?.provider ?? context.provider,
      status: source?.status,
      body: source?.body,
      requestId: source?.requestId,
      headers: source?.headers,
      cause: error,
    });
  }
}

const RETRYABLE: ReadonlySet<GeocoderErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "connection",
  "unavailable",
  "provider_error",
  "unsupported",
]);

const STATUS_CODES: Record<number, GeocoderErrorCode> = {
  400: "invalid_request",
  401: "unauthenticated",
  403: "permission_denied",
  404: "not_found",
  405: "unsupported",
  408: "timeout",
  409: "conflict",
  413: "payload_too_large",
  422: "invalid_request",
  429: "rate_limited",
  501: "unsupported",
  502: "unavailable",
  503: "unavailable",
  504: "unavailable",
};

function codeOf(error: unknown): GeocoderErrorCode {
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIConnectionError) return "connection";
  if (!(error instanceof OgError)) {
    // A signal's own reason, where something outside the transport let it through.
    const name =
      error !== null && typeof error === "object" ? (error as { name?: unknown }).name : "";
    return name === "TimeoutError" ? "timeout" : name === "AbortError" ? "aborted" : "unknown";
  }
  if (error.status === undefined) return "unknown";
  return (
    STATUS_CODES[error.status] ??
    (error.status >= 500 ? "provider_error" : error.status >= 400 ? "invalid_request" : "unknown")
  );
}
