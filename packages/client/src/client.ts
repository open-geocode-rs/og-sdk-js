/**
 * Typed client for the open-geocode API.
 *
 * Request and response types come from og's OpenAPI contract
 * (`contract/openapi.json`), generated into `schema.gen.ts` by `bun run gen`.
 */
import { APIUserAbortError } from "./errors.ts";
import {
  APIPromise,
  type Logger,
  type LogLevel,
  type RequestOptions,
  Transport,
  withRequestId,
} from "./core.ts";
import type { components, operations } from "./schema.gen.ts";

export type { components, operations, paths } from "./schema.gen.ts";
export {
  APIPromise,
  retryDelay,
  type Logger,
  type LogLevel,
  type RequestOptions,
  type WithResponse,
} from "./core.ts";
export * from "./errors.ts";

/** Every parameter optional and allowed to be `undefined`, which is then left out of the request. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

type Query<Op extends keyof operations> = operations[Op] extends { parameters: { query?: infer Q } }
  ? Loose<NonNullable<Q>>
  : never;

/** Query parameters of `GET /geocode`. */
export type GeocodeParams = Query<"geocode">;
/** Query parameters of `GET /reverse`. */
export type ReverseParams = Query<"reverse">;
/** Query parameters of `GET /autocomplete`. */
export type AutocompleteParams = Query<"autocomplete">;
/** Query parameters of `GET /places`. */
export type PlacesParams = Query<"places">;
/** Query parameters of `POST /jobs`. */
export type CreateJobParams = Query<"create">;

/** og's request ID, added to every parsed object response. Not enumerable. */
export interface RequestIdField {
  readonly _request_id?: string | undefined;
}

/** Forward results: `/geocode`, `/autocomplete` and `/places`. */
export type ForwardCollection = components["schemas"]["ForwardCollection"] & RequestIdField;
/** Reverse results: `/reverse`. */
export type ReverseCollection = components["schemas"]["ReverseCollection"] & RequestIdField;
/** A batch job's status. */
export type JobStatus = components["schemas"]["JobStatus"] & RequestIdField;
/** Where a job is: `running`, `completed`, `cancelled` or `failed`. */
export type JobState = components["schemas"]["JobState"];

/** Job upload: CSV with a header row, or one JSON object per line. */
export type JobBody = { csv: string } | { jsonl: string };

/** Options for `jobs.create`. */
export interface CreateJobOptions extends RequestOptions {
  /** Format of the results. Defaults to the upload's own format. */
  output?: "csv" | "jsonl" | undefined;
}

/** Options for `jobs.wait`. */
export interface WaitOptions extends RequestOptions {
  /** Milliseconds between status checks. Default 1000. */
  interval?: number | undefined;
}

/** Options for {@link createClient}. */
export interface ClientOptions {
  /** Where og runs, for example `http://localhost:8080`. */
  baseUrl: string;
  /** Headers sent with every request, for example your gateway's auth header. */
  headers?: Record<string, string> | undefined;
  /** A custom `fetch`. Defaults to the global one. */
  fetch?: typeof globalThis.fetch | undefined;
  /** Milliseconds before a request fails with `APIConnectionTimeoutError`. Default 60000. */
  timeout?: number | undefined;
  /** Times a failed request is retried, with exponential backoff. Default 2. `autocomplete` never retries unless asked. */
  maxRetries?: number | undefined;
  /** How much to log. Default `"warn"`. */
  logLevel?: LogLevel | undefined;
  /** Where to log. Default `console`. */
  logger?: Logger | undefined;
}

/** The open-geocode client. */
export interface Client {
  /** Forward geocoding: text or structured address to places. */
  geocode(params: GeocodeParams, options?: RequestOptions): APIPromise<ForwardCollection>;
  /** Reverse geocoding: a point to the nearest places. */
  reverse(params: ReverseParams, options?: RequestOptions): APIPromise<ReverseCollection>;
  /** Suggestions as the user types. Never retried by default, since a retried keystroke is already stale. */
  autocomplete(params: AutocompleteParams, options?: RequestOptions): APIPromise<ForwardCollection>;
  /** Place search by name, or lookup by `ids`. */
  places(params: PlacesParams, options?: RequestOptions): APIPromise<ForwardCollection>;
  jobs: {
    /** Uploads a batch job. Never retried, since a retry could start the job twice. */
    create(
      body: JobBody,
      params?: CreateJobParams,
      options?: CreateJobOptions,
    ): APIPromise<JobStatus>;
    /** The job's current status. */
    status(id: string, options?: RequestOptions): APIPromise<JobStatus>;
    /** Polls until the job stops, then returns its final status. */
    wait(id: string, options?: WaitOptions): Promise<JobStatus>;
    /** The job's results as one string, once the job has stopped. */
    results(id: string, options?: RequestOptions): APIPromise<string>;
    /** The job's results line by line as og writes them, including while it runs. */
    lines(id: string, options?: RequestOptions): AsyncIterable<string>;
    /** Stops a running job. */
    cancel(id: string, options?: RequestOptions): APIPromise<JobStatus>;
    /** Deletes a job and its results. */
    delete(id: string, options?: RequestOptions): APIPromise<void>;
  };
}

function job(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

/** Creates a client for one og server. */
export function createClient(options: ClientOptions): Client {
  const transport = new Transport({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    headers: options.headers ?? {},
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    timeout: options.timeout ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
    logLevel: options.logLevel ?? "warn",
    logger: options.logger ?? (typeof console === "undefined" ? silent : console),
  });

  const json = <T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    query: Record<string, unknown> | undefined,
    call: RequestOptions | undefined,
  ): APIPromise<T> =>
    new APIPromise(
      transport.send({
        method,
        path,
        ...(query ? { query } : {}),
        idempotent: true,
        options: call,
      }),
      async (response) => withRequestId((await response.json()) as T, response),
    );

  const status = (id: string, call?: RequestOptions): APIPromise<JobStatus> =>
    json("GET", job(id), undefined, call);

  return {
    geocode: (params, call) => json("GET", "/geocode", params, call),
    reverse: (params, call) => json("GET", "/reverse", params, call),
    autocomplete: (params, call) =>
      json("GET", "/autocomplete", params, { maxRetries: 0, ...call }),
    places: (params, call) => json("GET", "/places", params, call),
    jobs: {
      create(body, params, call) {
        const [contentType, text] =
          "csv" in body ? ["text/csv", body.csv] : ["application/jsonl", body.jsonl];
        const output =
          call?.output === undefined
            ? {}
            : { accept: call.output === "csv" ? "text/csv" : "application/jsonl" };
        return new APIPromise(
          transport.send({
            method: "POST",
            path: "/jobs",
            ...(params ? { query: params } : {}),
            body: text,
            headers: { "content-type": contentType, prefer: "respond-async", ...output },
            idempotent: false,
            options: call,
          }),
          async (response) => withRequestId((await response.json()) as JobStatus, response),
        );
      },
      status,
      async wait(id, call) {
        const interval = call?.interval ?? 1000;
        for (;;) {
          const current = await status(id, call);
          if (current.status !== "running") return current;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, interval);
            call?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new APIUserAbortError("Request was aborted."));
              },
              { once: true },
            );
          });
        }
      },
      results: (id, call) =>
        new APIPromise(
          transport.send({
            method: "GET",
            path: `${job(id)}/results`,
            headers: { accept: "*/*" },
            idempotent: true,
            options: call,
          }),
          (response) => response.text(),
        ),
      async *lines(id, call) {
        // No timeout by default: og keeps the stream open until the job stops.
        const response = await transport.send({
          method: "GET",
          path: `${job(id)}/results`,
          headers: { accept: "*/*" },
          idempotent: true,
          options: { timeout: 2 ** 31 - 1, ...call },
        });
        if (!response.body) return;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffered = "";
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += value;
            let newline: number;
            while ((newline = buffered.indexOf("\n")) >= 0) {
              const line = buffered.slice(0, newline).replace(/\r$/, "");
              buffered = buffered.slice(newline + 1);
              if (line !== "") yield line;
            }
          }
          if (buffered !== "") yield buffered;
        } finally {
          reader.releaseLock();
        }
      },
      cancel: (id, call) => json("POST", `${job(id)}/cancel`, undefined, call),
      delete: (id, call) =>
        new APIPromise(
          transport.send({ method: "DELETE", path: job(id), idempotent: true, options: call }),
          async () => undefined,
        ),
    },
  };
}
