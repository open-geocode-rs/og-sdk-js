import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  OgError,
} from "./errors.ts";

/** How much the client logs. */
export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

/** Where the client logs. Defaults to `console`. */
export interface Logger {
  error(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  debug(message: string, ...rest: unknown[]): void;
}

/** Options every call accepts, overriding the client's defaults. */
export interface RequestOptions {
  /** Cancels the request, for example when the user types the next letter. */
  signal?: AbortSignal | undefined;
  /** Milliseconds before the request fails with `APIConnectionTimeoutError`. `Infinity` or `0` sets no limit. */
  timeout?: number | undefined;
  /** Times a failed request is retried. */
  maxRetries?: number | undefined;
  /** Extra headers for this call. */
  headers?: Record<string, string> | undefined;
}

/** A parsed response together with the raw `Response`. */
export interface WithResponse<T, R extends Response | undefined = Response> {
  data: T;
  response: R;
  requestId: string | undefined;
}

const LEVELS: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** Statuses worth retrying besides 5xx: 408 Request Timeout and 429 Too Many Requests. */
const RETRY_STATUSES = new Set([408, 429]);

export interface TransportOptions {
  /** The provider's name, used in log lines and error messages. Default `og`. */
  name?: string | undefined;
  /** Reads a message out of the provider's error body. */
  describeError?: ((body: unknown, status: number) => string | undefined) | undefined;
  /** Response headers that may hold the provider's request ID, in order of preference. Default `x-request-id`. */
  requestIdHeaders?: readonly string[] | undefined;
  baseUrl: string;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;
  timeout: number;
  maxRetries: number;
  logLevel: LogLevel;
  logger: Logger;
}

export interface Call {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** A path under the transport's `baseUrl`, or an absolute URL. */
  path: string;
  query?: Record<string, unknown> | URLSearchParams;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Whether a retry can repeat the call safely. Job creation cannot. */
  idempotent: boolean;
  options: RequestOptions | undefined;
}

function toSearch(query: Record<string, unknown> | URLSearchParams | undefined): string {
  let search: URLSearchParams;
  if (query instanceof URLSearchParams) search = query;
  else {
    search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      search.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

/** The signals one request runs under, kept so a failure can be read by which of them fired. */
interface Watch {
  /** What `fetch` is given. Absent when there is neither a caller's signal nor a timeout. */
  signal: AbortSignal | undefined;
  caller: AbortSignal | undefined;
  /** The transport's own timeout. */
  timer: AbortSignal | undefined;
  timeout: number;
  provider: string;
}

/** A response's signals outlive `send`, since they also end the reading of its body. */
const watches = new WeakMap<Response, Watch>();

function watch(caller: AbortSignal | undefined, timeout: number, provider: string): Watch {
  const timer = Number.isFinite(timeout) && timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
  const parts = [caller, timer].filter((part) => part !== undefined);
  return {
    signal: parts.length === 2 ? AbortSignal.any(parts) : parts[0],
    caller,
    timer,
    timeout,
    provider,
  };
}

const nameOf = (reason: unknown): string | undefined =>
  reason !== null && typeof reason === "object" ? (reason as { name?: string }).name : undefined;

/**
 * The transport error for a request its signals ended, or `undefined` when none of them fired.
 * Which signal fired decides, never the name of what was thrown alone, since a runtime may
 * throw an `AbortError` for a timeout.
 */
function ended(watched: Watch, thrown?: unknown): OgError | undefined {
  const { signal, timer, caller, provider } = watched;
  if (!signal?.aborted) return undefined;
  // The DOMException is the cause. A runtime may throw something else, and then the signal holds it.
  const cause = nameOf(thrown) === nameOf(signal.reason) ? thrown : signal.reason;
  // With both fired, the signal given to fetch carries the reason of the one that fired first.
  if (timer?.aborted && signal.reason === timer.reason)
    return new APIConnectionTimeoutError(
      `${provider} did not answer within ${watched.timeout} ms.`,
      { cause, provider },
    );
  // A caller may pass a timeout signal of its own, which is a timeout all the same.
  return nameOf(caller?.reason) === "TimeoutError"
    ? new APIConnectionTimeoutError(
        `${provider} did not answer before the caller's signal timed out.`,
        {
          cause,
          provider,
        },
      )
    : new APIUserAbortError("Request was aborted.", { cause, provider });
}

/** The error for a caller's signal that has fired. */
function callerEnded(caller: AbortSignal, provider: string): OgError {
  return ended({
    signal: caller,
    caller,
    timer: undefined,
    timeout: Infinity,
    provider,
  }) as OgError;
}

/**
 * Resolves after `ms`, or rejects as soon as `signal` fires.
 * The wait is a real timer, since a timeout signal alone does not keep a process alive until it fires.
 */
export function sleep(ms: number, signal?: AbortSignal, provider = "og"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(callerEnded(signal, provider));
      return;
    }
    const stop = (): void => {
      clearTimeout(timer);
      reject(callerEnded(signal as AbortSignal, provider));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Reads a response's body. A read its request's signals end fails as the request itself would,
 * with a timeout or an abort, and not with whatever the runtime throws.
 */
export async function readBody<T>(
  response: Response,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  try {
    return await read(response);
  } catch (thrown) {
    const watched = watches.get(response);
    throw (watched && ended(watched, thrown)) ?? thrown;
  }
}

/** Delay before retry `attempt` (0-based): the server's `retry-after` if sane, else exponential backoff with jitter. */
export function retryDelay(attempt: number, headers: Headers | undefined): number {
  const ms = Number(headers?.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0 && ms <= 60_000) return ms;
  const after = headers?.get("retry-after");
  if (after) {
    const seconds = Number(after);
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
    if (Number.isFinite(wait) && wait > 0 && wait <= 60_000) return wait;
  }
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base * (1 - Math.random() * 0.25);
}

export class Transport {
  readonly #options: TransportOptions;
  readonly #name: string;

  constructor(options: TransportOptions) {
    this.#options = options;
    this.#name = options.name ?? "og";
  }

  /** The provider's request ID from a response, if it sent one. */
  requestId(headers: Headers): string | undefined {
    for (const name of this.#options.requestIdHeaders ?? ["x-request-id"]) {
      const value = headers.get(name);
      if (value) return value;
    }
    return undefined;
  }

  log(level: Exclude<LogLevel, "off">, message: string, ...rest: unknown[]): void {
    if (LEVELS[level] <= LEVELS[this.#options.logLevel])
      this.#options.logger[level](`[${this.#name}] ${message}`, ...rest);
  }

  /** Sends a call, retrying where safe, and returns the successful `Response`. */
  async send(call: Call): Promise<Response> {
    const { options } = call;
    const base = /^https?:\/\//.test(call.path) ? "" : this.#options.baseUrl;
    const url = `${base}${call.path}${toSearch(call.query)}`;
    const provider = this.#name;
    const maxRetries = call.idempotent ? (options?.maxRetries ?? this.#options.maxRetries) : 0;
    const timeout = options?.timeout ?? this.#options.timeout;
    const caller = options?.signal;
    for (let attempt = 0; ; attempt++) {
      // A retry never starts after the caller has given up.
      if (caller?.aborted) throw callerEnded(caller, provider);
      const watched = watch(caller, timeout, provider);
      this.log("debug", `${call.method} ${url}`, attempt > 0 ? { attempt } : "");
      let response: Response;
      try {
        response = await this.#options.fetch(url, {
          method: call.method,
          headers: {
            accept: "application/json",
            ...this.#options.headers,
            ...call.headers,
            ...options?.headers,
          },
          ...(call.body === undefined ? {} : { body: call.body }),
          ...(watched.signal === undefined ? {} : { signal: watched.signal }),
        });
      } catch (cause) {
        const error =
          ended(watched, cause) ??
          new APIConnectionError(`Could not reach ${provider}.`, { cause, provider });
        // Only the transport's own timeout is worth another try. The caller's signal ends the call.
        const own = watched.timer?.aborted === true && !caller?.aborted;
        if (caller?.aborted || (error instanceof APIConnectionTimeoutError && !own)) throw error;
        if (attempt < maxRetries) {
          const wait = retryDelay(attempt, undefined);
          this.log("info", `${error.message} Retrying in ${Math.round(wait)} ms.`);
          await sleep(wait, caller, provider);
          continue;
        }
        throw error;
      }
      watches.set(response, watched);
      if (response.ok) return response;
      const retryable = RETRY_STATUSES.has(response.status) || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        const wait = retryDelay(attempt, response.headers);
        this.log(
          "info",
          `${provider} answered ${response.status}. Retrying in ${Math.round(wait)} ms.`,
        );
        await response.body?.cancel();
        await sleep(wait, caller, provider);
        continue;
      }
      let body: unknown;
      const text = await readBody(response, (answer) => answer.text()).catch((failure: unknown) => {
        // A body the signals cut short is a timeout or an abort, not an error answer with no body.
        if (failure instanceof OgError) throw failure;
        return "";
      });
      try {
        body = JSON.parse(text);
      } catch {
        body = text === "" ? undefined : text;
      }
      const error = OgError.fromResponse(response.status, body, response.headers, {
        provider,
        message: this.#options.describeError?.(body, response.status),
        requestId: this.requestId(response.headers),
      });
      this.log(
        response.status >= 500 ? "error" : "warn",
        `${call.method} ${call.path}: ${error.message}`,
      );
      throw error;
    }
  }
}

/**
 * The promise every client method returns. Await it for the parsed data, or call
 * `withResponse()` for the data with the raw `Response`, or `asResponse()` for the
 * raw `Response` with its body unread.
 */
export class APIPromise<T, R extends Response | undefined = Response> extends Promise<T> {
  readonly #response: Promise<R>;
  readonly #parse: (response: R) => Promise<T>;
  readonly #requestId: (response: R) => string | undefined;
  #parsed: Promise<WithResponse<T, R>> | undefined;

  constructor(
    response: Promise<R>,
    parse: (response: R) => Promise<T>,
    requestId: (response: R) => string | undefined = (answer) =>
      answer?.headers.get("x-request-id") ?? undefined,
  ) {
    super((resolve) => resolve(undefined as T));
    this.#response = response;
    this.#parse = parse;
    this.#requestId = requestId;
    // Rejections surface through then(), withResponse() or asResponse(), never as unhandled.
    response.catch(() => {});
  }

  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  /** The raw `Response`. Its body is unread on the og client, and already read on a `Geocoder` call. */
  asResponse(): Promise<R> {
    return this.#response;
  }

  /** The parsed data, the raw `Response` and the provider's request ID. */
  withResponse(): Promise<WithResponse<T, R>> {
    this.#parsed ??= this.#response.then(async (response) => ({
      // A body the request's signals cut short fails as a timeout or an abort.
      data:
        response === undefined
          ? await this.#parse(response)
          : await readBody(response, this.#parse as (answer: Response) => Promise<T>),
      response,
      requestId: this.#requestId(response),
    }));
    return this.#parsed;
  }

  // APIPromise is a Promise, so it must define then().
  // oxlint-disable-next-line unicorn/no-thenable
  override then<A = T, B = never>(
    onfulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.withResponse()
      .then((result) => result.data)
      .then(onfulfilled, onrejected);
  }

  override catch<B = never>(
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<T | B> {
    return this.then(undefined, onrejected);
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then().finally(onfinally);
  }
}

/** Adds og's request ID to a parsed object as `_request_id`, not enumerable. */
export function withRequestId<T>(data: T, response: Response): T {
  if (data !== null && typeof data === "object") {
    Object.defineProperty(data, "_request_id", {
      value: response.headers.get("x-request-id") ?? undefined,
      enumerable: false,
    });
  }
  return data;
}
