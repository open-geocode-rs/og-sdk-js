/**
 * Typed client for the open-geocode API.
 *
 * Request and response types come from og's OpenAPI contract
 * (`contract/openapi.json`), generated into `schema.gen.ts` by `bun run gen`.
 */
import type { components, operations } from "./schema.gen.ts";

export type { components, operations, paths } from "./schema.gen.ts";

/** Every parameter optional and allowed to be `undefined`, which is then left out of the request. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

type Query<Op extends keyof operations> = operations[Op] extends {
  parameters: { query?: infer Q };
}
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

/** Forward results: `/geocode`, `/autocomplete` and `/places`. */
export type ForwardCollection = components["schemas"]["ForwardCollection"];
/** Reverse results: `/reverse`. */
export type ReverseCollection = components["schemas"]["ReverseCollection"];
/** An RFC 9457 problem document, as og returns on every error. */
export type Problem = components["schemas"]["Problem"];

/** Options for {@link createClient}. */
export interface ClientOptions {
  /** Where og runs, for example `http://localhost:8080`. */
  baseUrl: string;
  /** Headers sent with every request, for example your gateway's auth header. */
  headers?: Record<string, string>;
  /** A custom `fetch`. Defaults to the global one. */
  fetch?: typeof globalThis.fetch;
}

/** Per-call options. */
export interface CallOptions {
  /** Cancels the request, for example when the user types the next letter. */
  signal?: AbortSignal;
}

/** Thrown when og answers with an error status. */
export class OgError extends Error {
  /** HTTP status. */
  readonly status: number;
  /** og's stable error code. Branch on this, never on `message`. */
  readonly code: string | undefined;
  /** The full problem document, when og sent one. */
  readonly problem: Problem | undefined;
  /** The ID og logged the request under. Include it in bug reports. */
  readonly requestId: string | undefined;

  constructor(status: number, problem: Problem | undefined, requestId: string | undefined) {
    super(problem?.detail ?? problem?.title ?? `og answered ${status}`);
    this.name = "OgError";
    this.status = status;
    this.code = problem?.error_code;
    this.problem = problem;
    this.requestId = requestId;
  }
}

/** Job body: CSV with a header row, or one JSON object per line. */
export type JobBody = { csv: string } | { jsonl: string };

/** The open-geocode client. */
export interface Client {
  geocode(params: GeocodeParams, options?: CallOptions): Promise<ForwardCollection>;
  reverse(params: ReverseParams, options?: CallOptions): Promise<ReverseCollection>;
  autocomplete(params: AutocompleteParams, options?: CallOptions): Promise<ForwardCollection>;
  places(params: PlacesParams, options?: CallOptions): Promise<ForwardCollection>;
  jobs: {
    create(
      body: JobBody,
      params?: CreateJobParams,
      options?: CallOptions,
    ): Promise<components["schemas"]["JobStatus"]>;
    status(id: string, options?: CallOptions): Promise<components["schemas"]["JobStatus"]>;
    results(id: string, options?: CallOptions): Promise<string>;
    cancel(id: string, options?: CallOptions): Promise<components["schemas"]["JobStatus"]>;
    delete(id: string, options?: CallOptions): Promise<void>;
  };
}

type Params = Record<string, string | number | boolean | readonly (string | number)[] | undefined>;

function toSearch(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

function job(id: string): string {
  return `/jobs/${encodeURIComponent(id)}`;
}

/** Creates a client for one og server. */
export function createClient(options: ClientOptions): Client {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function send(
    method: string,
    path: string,
    params: Params,
    call: CallOptions | undefined,
    init: { body?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const response = await doFetch(`${base}${path}${toSearch(params)}`, {
      method,
      headers: { accept: "application/json", ...options.headers, ...init.headers },
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(call?.signal === undefined ? {} : { signal: call.signal }),
    });
    if (!response.ok) {
      let problem: Problem | undefined;
      try {
        problem = (await response.json()) as Problem;
      } catch {
        problem = undefined;
      }
      throw new OgError(
        response.status,
        problem,
        response.headers.get("x-request-id") ?? problem?.request_id ?? undefined,
      );
    }
    return response;
  }

  async function json<T>(
    method: string,
    path: string,
    params: Params,
    call?: CallOptions,
  ): Promise<T> {
    return (await (await send(method, path, params, call)).json()) as T;
  }

  return {
    geocode: (params, call) => json("GET", "/geocode", params as Params, call),
    reverse: (params, call) => json("GET", "/reverse", params as Params, call),
    autocomplete: (params, call) => json("GET", "/autocomplete", params as Params, call),
    places: (params, call) => json("GET", "/places", params as Params, call),
    jobs: {
      async create(body, params = {}, call) {
        const [contentType, text] =
          "csv" in body ? ["text/csv", body.csv] : ["application/jsonl", body.jsonl];
        const response = await send("POST", "/jobs", params as Params, call, {
          body: text,
          headers: { "content-type": contentType, prefer: "respond-async" },
        });
        return response.json();
      },
      status: (id, call) => json("GET", job(id), {}, call),
      async results(id, call) {
        return (await send("GET", `${job(id)}/results`, {}, call)).text();
      },
      cancel: (id, call) => json("POST", `${job(id)}/cancel`, {}, call),
      async delete(id, call) {
        await send("DELETE", job(id), {}, call);
      },
    },
  };
}
