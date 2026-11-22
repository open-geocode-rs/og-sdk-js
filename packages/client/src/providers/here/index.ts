/**
 * The HERE client. It speaks HERE Geocoding and Search v7 and HERE Batch API v7 by their own names,
 * and returns HERE's JSON as it arrived.
 *
 * ```ts
 * import { here } from "@open-geocode/client/here";
 *
 * const client = here({ baseUrl: "https://og.example.com" });
 * const { items } = await client.geocode({ q: "Invalidenstraße 116 Berlin" });
 * ```
 */
import { type ClientInfo, type CommonOptions, createBase, type Position } from "../../base.ts";
import type { APIPromise, CacheRule, RequestOptions } from "../../core.ts";
import type { GeocoderErrorCode, OgError } from "../../errors.ts";
import type {
  AutocompleteParams,
  AutosuggestParams,
  BatchCreateParams,
  BatchDeleteManyParams,
  BatchJobParams,
  BatchListParams,
  BrowseParams,
  DiscoverParams,
  GeocodeParams,
  HealthResponse,
  JobDetailResponse,
  JobResponse,
  JobsDeletedResponse,
  LookupParams,
  LookupResponse,
  MultiRevgeocodeParams,
  MultiRevgeocodeQuery,
  Notification,
  NotificationCreateParams,
  NotificationParams,
  NotificationUpdateParams,
  OpenSearchAutocompleteResponse,
  OpenSearchAutosuggestResponse,
  OpenSearchBrowseResponse,
  OpenSearchGeocodeResponse,
  OpenSearchMultiReverseGeocodeResponse,
  OpenSearchReverseGeocodeResponse,
  OpenSearchSearchResponse,
  PaginatedJobDetailResponse,
  QualifiedQuery,
  RevgeocodeParams,
  SignalsParams,
  VersionResponse,
} from "./types.ts";

export type * from "./types.ts";

/** Options for {@link here}. Give `baseUrl`, or one of `apiKey` and `bearerToken`. */
export interface HereOptions extends CommonOptions {
  /** An og server. Requests go to `<baseUrl>/compat/here`, and no HERE credential is sent. */
  baseUrl?: string | undefined;
  /** A HERE API key, for asking HERE itself. It is sent as the `apiKey` query parameter. */
  apiKey?: string | undefined;
  /**
   * A HERE OAuth token, for asking HERE itself. It is sent as `Authorization: Bearer` in place of the key.
   * A function is called for every request, so it can hand out a fresh token when the last one expired.
   */
  bearerToken?: string | (() => string | Promise<string>) | undefined;
}

/** The notification calls of the Batch API (BETA). */
export interface HereNotifications {
  /** Creates a notification. `POST /v7/batch/notifications`. */
  create(params: NotificationCreateParams, options?: RequestOptions): APIPromise<Notification>;
  /**
   * Lists the notifications. `GET /v7/batch/notifications`.
   * HERE's reference declares one notification here and its guide speaks of a list, so both are typed.
   */
  list(options?: RequestOptions): APIPromise<Notification | Notification[]>;
  /** Reads one notification. `GET /v7/batch/notifications/{notificationId}`. */
  get(params: NotificationParams, options?: RequestOptions): APIPromise<Notification>;
  /** Replaces one notification. `PUT /v7/batch/notifications/{notificationId}`. */
  update(params: NotificationUpdateParams, options?: RequestOptions): APIPromise<Notification>;
  /** Deletes one notification. `DELETE /v7/batch/notifications/{notificationId}`. */
  delete(params: NotificationParams, options?: RequestOptions): APIPromise<void>;
  /** Fires a test call of one notification. `GET /v7/batch/notifications/{notificationId}/test`. */
  test(params: NotificationParams, options?: RequestOptions): APIPromise<void>;
}

/** The HERE Batch API v7. A job runs every line of its input against one service. */
export interface HereBatch {
  /**
   * Creates a job from its input, and starts it unless `startJob` is `false`. `POST /v7/batch/jobs`.
   * It is never retried, since a second upload would be a second job.
   */
  create(params: BatchCreateParams, options?: RequestOptions): APIPromise<JobResponse>;
  /** Lists jobs, a page at a time. `GET /v7/batch/jobs`. */
  list(params?: BatchListParams, options?: RequestOptions): APIPromise<PaginatedJobDetailResponse>;
  /** Reads the status and the details of a job. `GET /v7/batch/jobs/{jobId}`. */
  status(params: BatchJobParams, options?: RequestOptions): APIPromise<JobDetailResponse>;
  /** Starts a job, or resumes a stopped one. `PUT /v7/batch/jobs/{jobId}/start`. */
  start(params: BatchJobParams, options?: RequestOptions): APIPromise<JobResponse>;
  /** Stops a job. Its partial results stay. `PUT /v7/batch/jobs/{jobId}/stop`. */
  stop(params: BatchJobParams, options?: RequestOptions): APIPromise<JobResponse>;
  /** Deletes a job and its results. `DELETE /v7/batch/jobs/{jobId}`. */
  delete(params: BatchJobParams, options?: RequestOptions): APIPromise<JobResponse>;
  /** Deletes every job of a status, and of a tag when one is given. `DELETE /v7/batch/jobs`. */
  deleteMany(
    params: BatchDeleteManyParams,
    options?: RequestOptions,
  ): APIPromise<JobsDeletedResponse>;
  /**
   * Downloads the results of a job as text, `csv` or `jsonl` as the job asked.
   * `GET /v7/batch/jobs/{jobId}/results`. The text is empty when the job has no results,
   * and the call fails with code `not_found` until the job has ended.
   */
  results(params: BatchJobParams, options?: RequestOptions): APIPromise<string>;
  /**
   * Downloads the error report of a job, as lines of `recId|errorCode|errorMessage`.
   * `GET /v7/batch/jobs/{jobId}/errors`. The text is empty when no record failed.
   */
  errors(params: BatchJobParams, options?: RequestOptions): APIPromise<string>;
  /** The notification calls (BETA). */
  notifications: HereNotifications;
  /** The versions of the service. `GET /v7/version`. */
  version(options?: RequestOptions): APIPromise<VersionResponse>;
  /** The health of the service. `GET /v7/health`. */
  health(options?: RequestOptions): APIPromise<HealthResponse>;
  /** The OpenAPI document of the Batch API, as text. `GET /v7/openapi`. */
  openapi(options?: RequestOptions): APIPromise<string>;
}

/** A client that speaks HERE's own API, to HERE or to an og server. */
export interface HereClient extends ClientInfo {
  /** Finds the coordinates of an address or a place. `GET /v1/geocode`. */
  geocode(params: GeocodeParams, options?: RequestOptions): APIPromise<OpenSearchGeocodeResponse>;
  /** Finds the nearest address to a point. `GET /v1/revgeocode`. */
  revgeocode(
    params: RevgeocodeParams,
    options?: RequestOptions,
  ): APIPromise<OpenSearchReverseGeocodeResponse>;
  /** Finds the nearest address to each of up to 100 points in one request. `POST /v1/multi-revgeocode`. */
  multiRevgeocode(
    params: MultiRevgeocodeParams,
    options?: RequestOptions,
  ): APIPromise<OpenSearchMultiReverseGeocodeResponse>;
  /**
   * Suggests addresses, places and follow-up queries for the text typed so far. `/v1/autosuggest`.
   * It is not retried unless `maxRetries` is given, since a retried keystroke is already stale.
   */
  autosuggest(
    params: AutosuggestParams,
    options?: RequestOptions,
  ): APIPromise<OpenSearchAutosuggestResponse>;
  /**
   * Completes the text typed so far to addresses and areas. `GET /v1/autocomplete`.
   * It is not retried unless `maxRetries` is given, since a retried keystroke is already stale.
   */
  autocomplete(
    params: AutocompleteParams,
    options?: RequestOptions,
  ): APIPromise<OpenSearchAutocompleteResponse>;
  /** Searches addresses and places by free text, most relevant first. `/v1/discover`. */
  discover(params: DiscoverParams, options?: RequestOptions): APIPromise<OpenSearchSearchResponse>;
  /** Reads one item by its HERE ID. `GET /v1/lookup`. */
  lookup(params: LookupParams, options?: RequestOptions): APIPromise<LookupResponse>;
  /** Lists places around a point by category, chain, food type or name, nearest first. `/v1/browse`. */
  browse(params: BrowseParams, options?: RequestOptions): APIPromise<OpenSearchBrowseResponse>;
  /**
   * Tells the service what an end user did with results, such as tapping or calling one. `POST /v1/signals`.
   * It is never retried, since a repeated signal counts twice.
   */
  signals(params: SignalsParams, options?: RequestOptions): APIPromise<void>;
  /** The Batch API v7 jobs. */
  batch: HereBatch;
}

/** A HERE service. HERE serves each from a host of its own, `https://{service}.search.hereapi.com`. */
type Service =
  | "geocode"
  | "revgeocode"
  | "multi-revgeocode"
  | "autosuggest"
  | "autocomplete"
  | "discover"
  | "browse"
  | "lookup"
  | "signals"
  | "batch";

const DAY = 24 * 60 * 60 * 1000;
/** The longest an answer of HERE is kept, whatever its headers say. */
const LONGEST = 30 * DAY;
const NEVER: CacheRule = { maxTtl: 0 };

const kept = (ms: number): CacheRule => ({ maxTtl: Math.min(Math.max(ms, 0), LONGEST) });

/**
 * How long an answer of HERE may be kept.
 * A cache never keeps an answer longer than the server that gave it allows, so the response's own
 * caching headers decide. An answer that says nothing is kept for 30 days, and none is kept longer.
 */
function cacheRule(response: Response): CacheRule {
  const { headers } = response;
  const directives = (headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .map((directive) => directive.trim().split("=", 2) as [string, string | undefined]);
  // `private` is for the end user's own cache, which a cache shared by a server's callers is not.
  if (directives.some(([name]) => name === "no-store" || name === "no-cache" || name === "private"))
    return NEVER;
  const age = directives.find(([name]) => name === "max-age")?.[1];
  if (age !== undefined) {
    const seconds = Number(age.replaceAll('"', ""));
    // The answer has already spent `Age` seconds in a cache on the way here.
    const spent = Number(headers.get("age") ?? 0);
    return Number.isFinite(seconds)
      ? kept((seconds - (Number.isFinite(spent) ? spent : 0)) * 1000)
      : NEVER;
  }
  const expires = headers.get("expires");
  if (expires !== null) {
    // A date that cannot be read means the answer has expired already.
    const until = Date.parse(expires);
    const sent = Date.parse(headers.get("date") ?? "");
    return Number.isNaN(until) ? NEVER : kept(until - (Number.isNaN(sent) ? Date.now() : sent));
  }
  return kept(LONGEST);
}

/** Either API's error body. Geocoding and Search, the Batch API and its 401 and 403 each have a shape. */
interface ErrorBody {
  title?: unknown;
  cause?: unknown;
  action?: unknown;
  code?: unknown;
  error_description?: unknown;
}

/** Reads a message out of either API's error body. */
function describeError(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = body as ErrorBody;
  if (typeof error.error_description === "string") return error.error_description;
  const parts = [error.title, error.cause, error.action].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  if (parts.length === 0) return undefined;
  return parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`)).join(" ");
}

function errorCode(error: OgError): GeocoderErrorCode | undefined {
  const body = error.body as ErrorBody | null | undefined;
  // The Batch API answers 400 for an input over its size limit.
  if (typeof body === "object" && body?.code === "E6004003") return "payload_too_large";
  return undefined;
}

interface Located {
  position?: { lat?: unknown; lng?: unknown } | undefined;
}

function point(item: Located | undefined): Position[] {
  const position = item?.position;
  return typeof position?.lat === "number" && typeof position.lng === "number"
    ? [{ lat: position.lat, lon: position.lng }]
    : [];
}

const listOf = (value: unknown): Located[] => (Array.isArray(value) ? (value as Located[]) : []);

/** The points of the results in an answer. Autocomplete has none, since its items carry no position. */
function positions(method: string, data: unknown): Position[] {
  if (data === null || typeof data !== "object") return [];
  switch (method) {
    case "geocode":
    case "revgeocode":
    case "autosuggest":
    case "discover":
    case "browse":
      return listOf((data as { items?: unknown }).items).flatMap(point);
    case "lookup":
      return point(data as Located);
    case "multiRevgeocode":
      // One point per sub-request, that of its best result.
      return listOf((data as { results?: unknown }).results).flatMap((result) =>
        point(listOf((result as { items?: unknown }).items)[0]),
      );
    default:
      return [];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The query HERE reads. An object becomes one `name[property]` key per property, which is how
 * HERE takes `evStation`, `fuelStation` and `addressNamesVariant`. Each key is sent once, since
 * HERE refuses a repeated one, and the transport joins a list with commas.
 */
function toQuery(params: object): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params)) {
    if (isRecord(value))
      for (const [property, inner] of Object.entries(value)) query[`${name}[${property}]`] = inner;
    else query[name] = value;
  }
  return query;
}

/** A qualified query as HERE writes it, `city=Berlin;country=Germany`. */
function qualified(qq: string | QualifiedQuery | undefined): string | undefined {
  if (qq === undefined || typeof qq === "string") return qq;
  const parts = Object.entries(qq).filter(([, value]) => value !== undefined && value !== "");
  return parts.length === 0
    ? undefined
    : parts.map(([name, value]) => `${name}=${value}`).join(";");
}

/**
 * Escapes what would end a value or a line, and leaves the `,`, `:`, `;` and `=` of HERE's own
 * syntax as they are, so a circle reads `circle:52.53,13.38;r=100` as in HERE's examples.
 */
const lineValue = (value: string | number): string =>
  encodeURIComponent(String(value)).replace(/%2C|%3A|%3B|%3D/gi, decodeURIComponent);

/** The body of a multi reverse geocode call, one sub-request per line in URL query syntax. */
function multiBody(body: readonly MultiRevgeocodeQuery[] | string): string {
  if (typeof body === "string") return body;
  return body
    .map((query) =>
      (["id", "at", "in", "bearing"] as const)
        .flatMap((name) => {
          const value = query[name];
          return value === undefined ? [] : [`${name}=${lineValue(value)}`];
        })
        .join("&"),
    )
    .join("\n");
}

/** The body of a signals call, one signal per line in URL query syntax. */
function signalsBody(body: SignalsParams["body"]): string {
  if (typeof body === "string") return body;
  return body
    .map((signal) =>
      (["action", "correlationId", "resourceId", "rank", "timestamp"] as const)
        .flatMap((name) => {
          const value = signal[name];
          return value === undefined ? [] : [`${name}=${lineValue(value)}`];
        })
        .reduce((line, field) => `${line}&${field}`, "version=1"),
    )
    .join("\n");
}

const TEXT = { "content-type": "text/plain; charset=UTF-8" };
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const JSON_BODY = { "content-type": "application/json" };

const jobPath = (params: BatchJobParams): string =>
  `/batch/jobs/${encodeURIComponent(params.jobId)}`;
const notificationPath = (params: NotificationParams): string =>
  `/batch/notifications/${encodeURIComponent(params.notificationId)}`;

const text = (response: Response): Promise<string> => response.text();
const nothing = async (): Promise<void> => {};

/**
 * Builds a HERE client.
 * With `baseUrl` it asks an og server, which serves HERE's API under `/compat/here`.
 * With `apiKey` or `bearerToken` and no `baseUrl` it asks HERE itself.
 */
export function here(config: HereOptions): HereClient {
  const base = createBase({
    shape: "here",
    options: config,
    baseUrl: config.baseUrl,
    credentials: config.apiKey !== undefined || config.bearerToken !== undefined,
    // A job's status or an upload is never kept. A lookup states its own rule, read from the response.
    cache: NEVER,
    describeError,
    // `X-Request-ID` only echoes what the caller sent. The correlation ID is HERE's own.
    requestIdHeaders: ["x-correlation-id"],
    errorCode,
    positions,
  });
  const og = base.server === "og";

  /**
   * The URL of a path of a service. og serves every service under one root by path.
   * The product is v7, and still its search paths are under `/v1` and only its batch paths under `/v7`.
   */
  const url = (service: Service, path: string): string => {
    const versioned = `/${service === "batch" ? "v7" : "v1"}${path}`;
    return og ? versioned : `https://${service}.search.hereapi.com${versioned}`;
  };

  /** Sends one request, with HERE's credential when HERE itself answers. og is sent none. */
  async function send(call: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    service: Service;
    path: string;
    query?: Record<string, unknown>;
    body?: BodyInit;
    headers?: Record<string, string>;
    idempotent?: boolean;
    options: RequestOptions | undefined;
  }): Promise<Response> {
    const query = { ...call.query };
    const headers = { ...call.headers };
    if (!og) {
      const { bearerToken, apiKey } = config;
      if (bearerToken !== undefined)
        headers["authorization"] =
          `Bearer ${typeof bearerToken === "string" ? bearerToken : await bearerToken()}`;
      else query["apiKey"] = apiKey;
    }
    return base.http({
      method: call.method ?? "GET",
      path: url(call.service, call.path),
      query,
      headers,
      ...(call.body === undefined ? {} : { body: call.body }),
      idempotent: call.idempotent ?? true,
      options: call.options,
    });
  }

  /**
   * A lookup, which goes through the plugins and is kept as long as its response allows.
   * A route goes in the body of a POST and never in the URL, since a long polyline does not fit
   * one and HERE refuses a parameter sent in both. Such a POST still only reads, so a retry is safe.
   */
  function search<T>(
    method: string,
    service: Service,
    params: object,
    options: RequestOptions | undefined,
    typeAhead = false,
  ): APIPromise<T> {
    const { route, ...rest } = params as { route?: string | undefined };
    return base.call<T>({
      method,
      args: [params],
      options,
      cache: cacheRule,
      send: (o) =>
        send({
          method: route === undefined ? "GET" : "POST",
          service,
          path: `/${service}`,
          query: toQuery(rest),
          ...(route === undefined
            ? {}
            : { body: new URLSearchParams({ route }).toString(), headers: FORM }),
          // A retried keystroke is already stale, so type-ahead is not retried unless the caller asks.
          options: typeAhead ? { maxRetries: 0, ...o } : o,
        }),
    });
  }

  /** A call of the Batch API. No plugin sees it, since a job is neither cached nor re-routed. */
  function job<T>(
    method: string,
    args: readonly unknown[],
    options: RequestOptions | undefined,
    call: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      path: string;
      query?: Record<string, unknown>;
      body?: BodyInit;
      headers?: Record<string, string>;
      idempotent?: boolean;
    },
    parse?: (response: Response) => Promise<T>,
  ): APIPromise<T> {
    return base.call<T>({
      method,
      args,
      options,
      plugins: false,
      parse,
      send: (o) => send({ ...call, service: "batch", options: o }),
    });
  }

  return {
    shape: base.shape,
    server: base.server,
    geocode: (params, options) =>
      search("geocode", "geocode", { ...params, qq: qualified(params.qq) }, options),
    revgeocode: (params, options) => search("revgeocode", "revgeocode", params, options),
    multiRevgeocode(params, options) {
      const { body, ...shared } = params;
      return base.call({
        method: "multiRevgeocode",
        args: [params],
        options,
        cache: cacheRule,
        send: (o) =>
          send({
            // The call only reads, so repeating it is safe.
            method: "POST",
            service: "multi-revgeocode",
            path: "/multi-revgeocode",
            query: toQuery(shared),
            body: multiBody(body),
            headers: TEXT,
            options: o,
          }),
      });
    },
    autosuggest: (params, options) => search("autosuggest", "autosuggest", params, options, true),
    autocomplete: (params, options) =>
      search("autocomplete", "autocomplete", params, options, true),
    discover: (params, options) => search("discover", "discover", params, options),
    lookup: (params, options) => search("lookup", "lookup", params, options),
    browse: (params, options) => search("browse", "browse", params, options),
    signals: (params, options) =>
      base.call({
        method: "signals",
        args: [params],
        options,
        // A signal reports, it does not look anything up, so no plugin and no cache sees it.
        plugins: false,
        parse: nothing,
        send: (o) =>
          send({
            method: "POST",
            service: "signals",
            path: "/signals",
            body: signalsBody(params.body),
            headers: FORM,
            idempotent: false,
            options: o,
          }),
      }),
    batch: {
      create(params, options) {
        const { body, contentEncoding, outputColumns, ...rest } = params;
        // HERE reads the column descriptor as it writes a result row, split
        // by the output delimiter, `|` unless the job names another.
        const delimiter = rest.outputDelimiter === "\\t" ? "\t" : (rest.outputDelimiter ?? "|");
        const query = {
          ...rest,
          outputColumns:
            outputColumns === undefined || typeof outputColumns === "string"
              ? outputColumns
              : outputColumns.join(delimiter),
        };
        return job("batch.create", [params], options, {
          method: "POST",
          path: "/batch/jobs",
          query,
          body,
          headers:
            contentEncoding === undefined ? TEXT : { ...TEXT, "content-encoding": contentEncoding },
          // A second upload would be a second job.
          idempotent: false,
        });
      },
      list: (params, options) =>
        job("batch.list", [params], options, {
          path: "/batch/jobs",
          query: { ...params },
        }),
      status: (params, options) =>
        job("batch.status", [params], options, { path: jobPath(params) }),
      // Starting a job that runs, or stopping one that does not, changes nothing, so a retry is safe.
      start: (params, options) =>
        job("batch.start", [params], options, { method: "PUT", path: `${jobPath(params)}/start` }),
      stop: (params, options) =>
        job("batch.stop", [params], options, { method: "PUT", path: `${jobPath(params)}/stop` }),
      delete: (params, options) =>
        job("batch.delete", [params], options, { method: "DELETE", path: jobPath(params) }),
      deleteMany: (params, options) =>
        job("batch.deleteMany", [params], options, {
          method: "DELETE",
          path: "/batch/jobs",
          query: { ...params },
        }),
      results: (params, options) =>
        job("batch.results", [params], options, { path: `${jobPath(params)}/results` }, text),
      errors: (params, options) =>
        job("batch.errors", [params], options, { path: `${jobPath(params)}/errors` }, text),
      notifications: {
        create: (params, options) =>
          job("batch.notifications.create", [params], options, {
            method: "POST",
            path: "/batch/notifications",
            body: JSON.stringify(params),
            headers: JSON_BODY,
            // A second request would be a second notification.
            idempotent: false,
          }),
        list: (options) =>
          job("batch.notifications.list", [], options, { path: "/batch/notifications" }),
        get: (params, options) =>
          job("batch.notifications.get", [params], options, { path: notificationPath(params) }),
        update(params, options) {
          const { notificationId: _, ...body } = params;
          return job("batch.notifications.update", [params], options, {
            method: "PUT",
            path: notificationPath(params),
            body: JSON.stringify(body),
            headers: JSON_BODY,
          });
        },
        delete: (params, options) =>
          job(
            "batch.notifications.delete",
            [params],
            options,
            { method: "DELETE", path: notificationPath(params) },
            nothing,
          ),
        test: (params, options) =>
          job(
            "batch.notifications.test",
            [params],
            options,
            { path: `${notificationPath(params)}/test` },
            nothing,
          ),
      },
      version: (options) => job("batch.version", [], options, { path: "/version" }),
      health: (options) => job("batch.health", [], options, { path: "/health" }),
      openapi: (options) => job("batch.openapi", [], options, { path: "/openapi" }, text),
    },
  };
}
