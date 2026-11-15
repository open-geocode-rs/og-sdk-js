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
  /** Milliseconds before the request fails with `APIConnectionTimeoutError`. */
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
  body?: string;
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

const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new APIUserAbortError("Request was aborted."));
      },
      { once: true },
    );
  });

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
    for (let attempt = 0; ; attempt++) {
      if (options?.signal?.aborted) throw new APIUserAbortError("Request was aborted.");
      const timer = AbortSignal.timeout(timeout);
      const signal = options?.signal ? AbortSignal.any([options.signal, timer]) : timer;
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
          signal,
        });
      } catch (cause) {
        if (options?.signal?.aborted)
          throw new APIUserAbortError("Request was aborted.", { cause, provider });
        const error = timer.aborted
          ? new APIConnectionTimeoutError(`${provider} did not answer within ${timeout} ms.`, {
              cause,
              provider,
            })
          : new APIConnectionError(`Could not reach ${provider}.`, { cause, provider });
        if (attempt < maxRetries) {
          const wait = retryDelay(attempt, undefined);
          this.log("info", `${error.message} Retrying in ${Math.round(wait)} ms.`);
          await sleep(wait, options?.signal);
          continue;
        }
        throw error;
      }
      if (response.ok) return response;
      const retryable = RETRY_STATUSES.has(response.status) || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        const wait = retryDelay(attempt, response.headers);
        this.log(
          "info",
          `${provider} answered ${response.status}. Retrying in ${Math.round(wait)} ms.`,
        );
        await response.body?.cancel();
        await sleep(wait, options?.signal);
        continue;
      }
      let body: unknown;
      const text = await response.text().catch(() => "");
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
      data: await this.#parse(response),
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
