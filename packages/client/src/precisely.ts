/**
 * A client that speaks Precisely's Data Integrity Suite APIs.
 * Its methods, requests and responses are Precisely's own, and an answer is handed back as it was sent.
 *
 * ```ts
 * import { precisely } from "@open-geocode/client/precisely";
 *
 * // Ask an og server, which answers in Precisely's shape. No Precisely account is needed.
 * const client = precisely({ baseUrl: "https://og.example.com" });
 * // Or ask Precisely itself.
 * const vendor = precisely({ apiKey: "...", apiSecret: "..." });
 *
 * const { responses } = await client.geocode({
 *   addresses: [{ addressLines: ["2 Avenue de Monte-Carlo"], country: "MCO" }],
 * });
 * ```
 */
import {
  type ClientInfo,
  type CommonOptions,
  createBase,
  type Position,
  type Step,
} from "./base.ts";
import { type APIPromise, type CacheRule, type Call, type RequestOptions } from "./core.ts";
import {
  APIConnectionTimeoutError,
  APIUserAbortError,
  type GeocoderErrorCode,
  OgError,
} from "./errors.ts";
import type {
  AutocompleteParams,
  AutocompleteResponse,
  BulkJobParams,
  BulkJobResponse,
  CancelJobResponse,
  DeleteFileParams,
  DeleteFileResponse,
  ExplainAddressCodeParams,
  ExplainAddressCodeResponse,
  ExpressAutocompleteV2Params,
  GeocodeParams,
  GeocodeResponse,
  JobParams,
  JobStatusResponse,
  ListFilesResponse,
  ListJobsParams,
  ListJobsResponse,
  LookupParams,
  LookupResponse,
  PostalCityParams,
  PostalCityResponse,
  ProximitySearchParams,
  ProximitySearchResponse,
  ResultsParams,
  ReverseGeocodeParams,
  ReverseGeocodeResponse,
  TokenResponse,
  UploadParams,
  UploadUrlParams,
  UploadUrlResponse,
  VerifyParams,
  VerifyResponse,
} from "./precisely.types.ts";

export type * from "./precisely.types.ts";

/** The host of the token call and the bulk calls, and of the real-time calls unless a region is chosen. */
const HOST = "https://api.cloud.precisely.com";

/** The regions Precisely answers real-time Geo Addressing calls from, besides its default host. */
export type PreciselyRegion = "eu1" | "au1" | "gb1";

/**
 * Options for {@link precisely} against an og server.
 * A key, secret and region the caller already passes for Precisely may stay, so switching is one added line, and none of them is sent.
 */
export interface PreciselyOgOptions extends CommonOptions {
  /** An og server. Requests go to `<baseUrl>/compat/precisely`, and no key, secret or token is sent. */
  baseUrl: string;
  /** Accepted and never sent to og. */
  apiKey?: string | undefined;
  /** Accepted and never sent to og. */
  apiSecret?: string | undefined;
  /** Accepted and unused, since og answers every call itself. */
  region?: PreciselyRegion | undefined;
}

/** Options for {@link precisely} against Precisely itself. */
export interface PreciselyVendorOptions extends CommonOptions {
  baseUrl?: undefined;
  /** A Precisely API key. */
  apiKey: string;
  /** The secret of the API key. */
  apiSecret: string;
  /**
   * The regional host that answers the real-time calls.
   * Default `https://api.cloud.precisely.com`.
   * The token call and the bulk calls always go to the default host, the only one Precisely documents for them.
   */
  region?: PreciselyRegion | undefined;
}

/** Options for {@link precisely}. Give `baseUrl`, or `apiKey` with `apiSecret`. */
export type PreciselyOptions = PreciselyOgOptions | PreciselyVendorOptions;

/** The Precisely client against Precisely itself, which also trades the key for a token. */
export interface PreciselyVendorClient extends PreciselyClient {
  /**
   * `POST /auth/v2/token`. Trades the API key and secret for a bearer token.
   * The other methods do this by themselves, so call it only to hand a token to something else.
   */
  token(options?: RequestOptions): APIPromise<TokenResponse>;
}

/** The Precisely client. Against og it sends no token, so it has no token call. */
export interface PreciselyClient extends ClientInfo {
  /** `POST /v1/geocode`. Finds the point of up to 25 addresses. */
  geocode(params: GeocodeParams, options?: RequestOptions): APIPromise<GeocodeResponse>;
  /** `POST /v1/reverse-geocode`. Finds the address at up to 25 points. */
  reverseGeocode(
    params: ReverseGeocodeParams,
    options?: RequestOptions,
  ): APIPromise<ReverseGeocodeResponse>;
  /** `POST /v1/lookup`. Finds the address of up to 25 keys, such as the `PB_KEY` of an earlier answer. */
  lookup(params: LookupParams, options?: RequestOptions): APIPromise<LookupResponse>;
  /** `POST /v1/verify`. Checks and corrects up to 25 addresses. */
  verify(params: VerifyParams, options?: RequestOptions): APIPromise<VerifyResponse>;
  /** `POST /v1/autocomplete`. Predicts the address being typed. It is not retried unless `maxRetries` says so. */
  autocomplete(
    params: AutocompleteParams,
    options?: RequestOptions,
  ): APIPromise<AutocompleteResponse>;
  /** `POST /v1/express-autocomplete`. The same as `autocomplete`, from Precisely's faster index. */
  expressAutocomplete(
    params: AutocompleteParams,
    options?: RequestOptions,
  ): APIPromise<AutocompleteResponse>;
  /** `POST /v2/express-autocomplete`. The same again, with `preferences.filterBias` to narrow or rank the predictions. */
  expressAutocompleteV2(
    params: ExpressAutocompleteV2Params,
    options?: RequestOptions,
  ): APIPromise<AutocompleteResponse>;
  /**
   * `POST /v1/autocomplete/postal-city`. Predicts the postal code or town being typed.
   * It is not retried unless `maxRetries` says so.
   */
  autocompletePostalCity(
    params: PostalCityParams,
    options?: RequestOptions,
  ): APIPromise<PostalCityResponse>;
  /** `POST /v1/proximity-search`. Finds the addresses nearest a point. */
  proximitySearch(
    params: ProximitySearchParams,
    options?: RequestOptions,
  ): APIPromise<ProximitySearchResponse>;
  /** `POST /v1/explain-addresscode`. Reads up to 25 codes of an earlier answer, such as a Global Match Code, as words. */
  explainAddressCode(
    params: ExplainAddressCodeParams,
    options?: RequestOptions,
  ): APIPromise<ExplainAddressCodeResponse>;
  /** Bulk Geo Addressing v2. Upload a file, start a job over it, poll the job and read its output. */
  bulk: {
    /** `POST /v2/files/upload-url`. Asks for a file ID and the URL to upload the input file to. */
    uploadUrl(params: UploadUrlParams, options?: RequestOptions): APIPromise<UploadUrlResponse>;
    /** `PUT {url}`. Sends the input file to the URL `uploadUrl` answered. It is never retried. */
    upload(params: UploadParams, options?: RequestOptions): APIPromise<void>;
    /** `GET /v2/files`. Lists the uploaded files. */
    files(options?: RequestOptions): APIPromise<ListFilesResponse>;
    /** `DELETE /v2/files/{fileId}`. Deletes an uploaded file. */
    deleteFile(params: DeleteFileParams, options?: RequestOptions): APIPromise<DeleteFileResponse>;
    /** `POST /v2/bulk-geocode`. Starts a geocode job over an uploaded file. It is never retried. */
    geocode(params: BulkJobParams, options?: RequestOptions): APIPromise<BulkJobResponse>;
    /** `POST /v2/bulk-verify`. Starts a verify job over an uploaded file. It is never retried. */
    verify(params: BulkJobParams, options?: RequestOptions): APIPromise<BulkJobResponse>;
    /** `GET /v2/bulk/jobs`. Lists the jobs that wait or run. */
    jobs(params?: ListJobsParams, options?: RequestOptions): APIPromise<ListJobsResponse>;
    /** `GET /v2/bulk/jobs/{jobId}`. Reads the state of a job, and where its output is once it completed. */
    status(params: JobParams, options?: RequestOptions): APIPromise<JobStatusResponse>;
    /** `DELETE /v2/bulk/jobs/{jobId}`. Cancels a job that has not started. */
    cancel(params: JobParams, options?: RequestOptions): APIPromise<CancelJobResponse>;
    /**
     * `GET {downloadUrl}`. Reads the output file of a completed job, as CSV text.
     * The whole file is held in memory. For a large one, fetch `downloadUrl` yourself and read it as a stream.
     */
    results(params: ResultsParams, options?: RequestOptions): APIPromise<string>;
  };
}

/** The job ID in the `statusUrl` a bulk submission answers, which is the last segment of its path. */
export function jobIdOf(statusUrl: string): string {
  const path = statusUrl.split(/[?#]/)[0] ?? "";
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

// A cache never keeps an answer longer than the server that gave it allows. For Precisely that is 30 days.
const CACHE: CacheRule = { maxTtl: 30 * 86_400_000 };
/** A token, a job's state and a signed URL all go stale within minutes, so none of them is kept. */
const NEVER: CacheRule = { maxTtl: 0 };

/** A token is renewed this long before Precisely would refuse it, so a request never leaves with one about to expire. */
const RENEW_BEFORE_MS = 60_000;

/** Fields of the params that travel as request headers, under the same names. */
const HEADER_FIELDS: ReadonlySet<string> = new Set([
  "X-Request-Id",
  "X-Transaction-Id",
  "X-CASS-FLOW",
]);

/** Parts the params into the headers and what is left, which is the body or the path and query. */
function split(params: object | undefined): {
  headers: Record<string, string>;
  rest: Record<string, unknown>;
} {
  const headers: Record<string, string> = {};
  const rest: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    if (!HEADER_FIELDS.has(name)) rest[name] = value;
    else if (typeof value === "string") headers[name] = value;
  }
  return { headers, rest };
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

/** The first entry of Precisely's error envelope. */
function firstError(body: unknown): Record<string, unknown> | undefined {
  const errors = record(body)?.["errors"];
  return Array.isArray(errors) ? record(errors[0]) : undefined;
}

function describeError(body: unknown): string | undefined {
  const errors = record(body)?.["errors"];
  if (Array.isArray(errors)) {
    const messages = errors
      .map((error: unknown) => text(record(error)?.["errorMessage"]))
      .filter((message) => message !== undefined);
    if (messages.length > 0) return messages.join(" ");
  }
  // The token call answers in the OAuth error shape.
  return text(record(body)?.["error_description"]);
}

/**
 * Precisely's error codes whose meaning the HTTP status does not carry, or is not documented to carry.
 * The token call, for one, answers a wrong key with 400.
 */
const DIS_CODES: Record<string, GeocoderErrorCode> = {
  "DIS-1004": "unauthenticated",
  "DIS-1006": "unauthenticated",
  "DIS-LI-1013": "unauthenticated",
  "DIS-LI-1024": "unauthenticated",
  "DIS-AUTH-1002": "unauthenticated",
  "DIS-AUTH-1003": "unauthenticated",
  "DIS-AUTH-1020": "unauthenticated",
  "DIS-1007": "rate_limited",
  "DIS-1009": "rate_limited",
  "DIS-1010": "permission_denied",
  "DIS-AUTH-1022": "permission_denied",
  "DIS-LI-1029": "permission_denied",
  "DIS-LI-1035": "permission_denied",
};

/** A `status` word that says more than the HTTP status it comes with. */
const STATUS_CODES: Record<string, GeocoderErrorCode> = {
  REQUEST_TIMEOUT: "timeout",
};

/** The OAuth errors of the token call that its HTTP status, always 400 or 500, does not tell apart. */
const OAUTH_CODES: Record<string, GeocoderErrorCode> = {
  access_denied: "permission_denied",
  temporarily_unavailable: "unavailable",
};

/** A token call that answered 200 without a token that can be used. */
class TokenError extends OgError {}

function errorCode(error: OgError): GeocoderErrorCode | undefined {
  if (error instanceof TokenError) return "provider_error";
  const first = firstError(error.body);
  const message =
    text(first?.["errorMessage"]) ?? text(record(error.body)?.["error_description"]) ?? "";
  const code = /\((DIS-[A-Z0-9-]+)\)/.exec(message)?.[1];
  return (
    DIS_CODES[code ?? ""] ??
    STATUS_CODES[text(first?.["status"]) ?? ""] ??
    OAUTH_CODES[text(record(error.body)?.["error"]) ?? ""]
  );
}

/** The point of one candidate. Precisely writes it as x then y, which is longitude then latitude. */
function pointOf(result: unknown): Position | undefined {
  const location = record(record(result)?.["location"]);
  const geometry = record(record(location?.["feature"])?.["geometry"]);
  const coordinates: unknown = geometry?.["coordinates"];
  if (!Array.isArray(coordinates)) return undefined;
  const [lon, lat] = coordinates as unknown[];
  return typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat)
    ? { lat, lon }
    : undefined;
}

const pointsOf = (results: unknown): Position[] =>
  (Array.isArray(results) ? results : []).map(pointOf).filter((point) => point !== undefined);

/** The methods that answer `responses`, one entry per item sent. */
const BATCH_METHODS: ReadonlySet<string> = new Set([
  "geocode",
  "reverseGeocode",
  "lookup",
  "verify",
]);
/** The methods that answer `response.predictions`. */
const PREDICTION_METHODS: ReadonlySet<string> = new Set([
  "autocomplete",
  "expressAutocomplete",
  "expressAutocompleteV2",
  "autocompletePostalCity",
]);

/** The point of a proximity search result, which Precisely writes as a latitude and a longitude. */
function proximityPoint(result: unknown): Position | undefined {
  const location = record(record(result)?.["location"]);
  const lat: unknown = location?.["latitude"];
  const lon: unknown = location?.["longitude"];
  return typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat)
    ? { lat, lon }
    : undefined;
}

/**
 * The points of an answer. A request with one item gives every candidate of that item.
 * A request with several gives the first candidate of each, so the points line up with the items.
 */
function positions(method: string, data: unknown): Position[] {
  if (PREDICTION_METHODS.has(method))
    return pointsOf(record(record(data)?.["response"])?.["predictions"]);
  if (method === "proximitySearch") {
    const results = record(record(data)?.["response"])?.["results"];
    return (Array.isArray(results) ? results : [])
      .map(proximityPoint)
      .filter((point) => point !== undefined);
  }
  if (!BATCH_METHODS.has(method)) return [];
  const responses = record(data)?.["responses"];
  if (!Array.isArray(responses)) return [];
  if (responses.length === 1) return pointsOf(record(responses[0])?.["results"]);
  return responses
    .map((item: unknown) => {
      const results = record(item)?.["results"];
      return Array.isArray(results) ? pointOf(results[0]) : undefined;
    })
    .filter((point) => point !== undefined);
}

/**
 * Waits for work that several callers share, and gives up as soon as this caller's signal fires.
 * The shared work goes on for the others.
 */
function until<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work;
  return new Promise<T>((resolve, reject) => {
    const stop = (): void => {
      const reason: unknown = signal.reason;
      const timedOut = record(reason)?.["name"] === "TimeoutError";
      reject(
        timedOut
          ? new APIConnectionTimeoutError(
              "precisely did not answer before the caller's signal timed out.",
              { cause: reason, provider: "precisely" },
            )
          : new APIUserAbortError("Request was aborted.", { cause: reason, provider: "precisely" }),
      );
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

const json = (
  rest: Record<string, unknown>,
  headers: Record<string, string>,
): Pick<Call, "body" | "headers"> => ({
  body: JSON.stringify(rest),
  headers: { "content-type": "application/json", ...headers },
});

const jobPath = (params: JobParams): string => `/v2/bulk/jobs/${encodeURIComponent(params.jobId)}`;

/**
 * Builds a client that speaks Precisely's API.
 * It asks the og server at `baseUrl`, or Precisely itself when `apiKey` and `apiSecret` are given.
 */
export function precisely(options: PreciselyOgOptions): PreciselyClient;
export function precisely(options: PreciselyVendorOptions): PreciselyVendorClient;
export function precisely(options: PreciselyOptions): PreciselyClient | PreciselyVendorClient;
export function precisely(options: PreciselyOptions): PreciselyClient | PreciselyVendorClient {
  const base = createBase({
    shape: "precisely",
    options,
    baseUrl: options.baseUrl,
    credentials: options.apiKey !== undefined && options.apiSecret !== undefined,
    vendorUrl: HOST,
    cache: CACHE,
    describeError,
    // The storage host that takes the uploads and gives the output names its requests under this header.
    requestIdHeaders: ["x-amz-request-id"],
    errorCode,
    positions,
  });
  const vendor = base.server !== "og";
  const basic = vendor ? btoa(`${options.apiKey}:${options.apiSecret}`) : undefined;
  const realtimeHost =
    vendor && options.region !== undefined
      ? `https://api.${options.region}.cloud.precisely.com`
      : "";

  const exchange = (o: RequestOptions | undefined): Promise<Response> =>
    base.http({
      method: "POST",
      path: "/auth/v2/token",
      body: "grant_type=client_credentials&scope=default",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(basic === undefined ? {} : { authorization: `Basic ${basic}` }),
      },
      idempotent: true,
      options: o,
    });

  let held: { token: string; until: number } | undefined;
  let pending: Promise<string> | undefined;

  /** The bearer token, from memory while it lasts. Concurrent callers share one exchange. */
  function bearer(signal: AbortSignal | undefined): Promise<string> {
    if (held !== undefined && held.until > Date.now()) return Promise.resolve(held.token);
    // The exchange runs under the client's own timeout and under no caller's signal,
    // so one caller giving up does not fail the others that wait for the same token.
    pending ??= exchange(undefined)
      .then(async (response) => {
        const answer = record(await response.json().catch(() => undefined));
        const token = text(answer?.["access_token"]);
        if (token === undefined)
          throw new TokenError("precisely answered the token call without a token.", {
            status: response.status,
            headers: response.headers,
            body: answer,
            provider: "precisely",
          });
        const seconds = answer?.["expires_in"];
        const lasts = typeof seconds === "number" && seconds > 0 ? seconds * 1000 : 0;
        held = { token, until: Date.now() + Math.max(0, lasts - RENEW_BEFORE_MS) };
        return token;
      })
      .finally(() => {
        pending = undefined;
      });
    return until(pending, signal);
  }

  /** Sends a call to Precisely with the bearer token, or to og with none. */
  async function authorized(call: Call): Promise<Response> {
    if (!vendor) return base.http(call);
    const signal = call.options?.signal;
    const withToken = (token: string): Call => ({
      ...call,
      headers: { ...call.headers, authorization: `Bearer ${token}` },
    });
    const token = await bearer(signal);
    try {
      return await base.http(withToken(token));
    } catch (thrown) {
      if (!(thrown instanceof OgError) || thrown.status !== 401) throw thrown;
      // Precisely refused the token before its time, so it is dropped and one fresh token is tried.
      // Another caller may have replaced it already, and then that newer one is kept.
      if (held?.token === token) held = undefined;
      return base.http(withToken(await bearer(signal)));
    }
  }

  /** A real-time lookup. It is a POST that only reads, so a retry may repeat it. */
  const lookup = <T>(
    method: string,
    path: string,
    params: object,
    request: RequestOptions | undefined,
    typeAhead = false,
  ): APIPromise<T> =>
    base.call<T>({
      method,
      args: [params],
      options: request,
      send: (o) => {
        const { headers, rest } = split(params);
        return authorized({
          method: "POST",
          path: `${realtimeHost}${path}`,
          ...json(rest, headers),
          idempotent: true,
          // A retried keystroke is already stale, so a type-ahead call is sent once unless the caller asks for more.
          options: typeAhead ? { ...o, maxRetries: o?.maxRetries ?? 0 } : o,
        });
      },
    });

  /** A call of the token, file and job flow, which no plugin caches or sends elsewhere. */
  const job = <T>(
    step: Pick<Step<T>, "method" | "args" | "options" | "send" | "parse">,
  ): APIPromise<T> => base.call<T>({ ...step, plugins: false, cache: NEVER });

  const submit =
    (method: string, path: string) =>
    (params: BulkJobParams, request?: RequestOptions): APIPromise<BulkJobResponse> =>
      job({
        method,
        args: [params],
        options: request,
        send: (o) => {
          const { headers, rest } = split(params);
          // A second submission would start a second job, so this is sent once.
          return authorized({
            method: "POST",
            path,
            ...json(rest, headers),
            idempotent: false,
            options: o,
          });
        },
      });

  const client: PreciselyClient = {
    shape: base.shape,
    server: base.server,
    geocode: (params, request) => lookup("geocode", "/v1/geocode", params, request),
    reverseGeocode: (params, request) =>
      lookup("reverseGeocode", "/v1/reverse-geocode", params, request),
    lookup: (params, request) => lookup("lookup", "/v1/lookup", params, request),
    verify: (params, request) => lookup("verify", "/v1/verify", params, request),
    autocomplete: (params, request) =>
      lookup("autocomplete", "/v1/autocomplete", params, request, true),
    expressAutocomplete: (params, request) =>
      lookup("expressAutocomplete", "/v1/express-autocomplete", params, request, true),
    expressAutocompleteV2: (params, request) =>
      lookup("expressAutocompleteV2", "/v2/express-autocomplete", params, request, true),
    autocompletePostalCity: (params, request) =>
      lookup("autocompletePostalCity", "/v1/autocomplete/postal-city", params, request, true),
    proximitySearch: (params, request) =>
      lookup("proximitySearch", "/v1/proximity-search", params, request),
    explainAddressCode: (params, request) =>
      lookup("explainAddressCode", "/v1/explain-addresscode", params, request),
    bulk: {
      uploadUrl: (params, request) =>
        job({
          method: "bulk.uploadUrl",
          args: [params],
          options: request,
          send: (o) => {
            const { headers, rest } = split(params);
            // Every call answers a new file ID, so a repeat would leave a file nobody uploads to.
            return authorized({
              method: "POST",
              path: "/v2/files/upload-url",
              ...json(rest, headers),
              idempotent: false,
              options: o,
            });
          },
        }),
      upload: (params, request) =>
        job<void>({
          method: "bulk.upload",
          args: [params],
          options: request,
          send: (o) =>
            base.http({
              // A signed URL is its own credential, and it points at a storage host and not at Precisely.
              // That host gets neither the bearer token nor the headers the client was given for Precisely.
              // og hands out URLs of its own, so there the upload goes the way every request goes.
              bare: vendor,
              method: "PUT",
              path: params.url,
              body: params.content as BodyInit,
              headers: { "content-type": params.contentType ?? "text/csv" },
              idempotent: false,
              options: o,
            }),
          // Neither Precisely's storage nor og answers an upload with a body worth keeping.
          parse: async (response) => {
            await response.text();
          },
        }),
      files: (request) =>
        job({
          method: "bulk.files",
          args: [],
          options: request,
          send: (o) =>
            authorized({ method: "GET", path: "/v2/files", idempotent: true, options: o }),
        }),
      deleteFile: (params, request) =>
        job({
          method: "bulk.deleteFile",
          args: [params],
          options: request,
          send: (o) =>
            authorized({
              method: "DELETE",
              path: `/v2/files/${encodeURIComponent(params.fileId)}`,
              headers: split(params).headers,
              idempotent: true,
              options: o,
            }),
        }),
      geocode: submit("bulk.geocode", "/v2/bulk-geocode"),
      verify: submit("bulk.verify", "/v2/bulk-verify"),
      jobs: (params, request) =>
        job({
          method: "bulk.jobs",
          args: [params],
          options: request,
          send: (o) => {
            const { headers, rest } = split(params);
            return authorized({
              method: "GET",
              path: "/v2/bulk/jobs",
              query: rest,
              headers,
              idempotent: true,
              options: o,
            });
          },
        }),
      status: (params, request) =>
        job({
          method: "bulk.status",
          args: [params],
          options: request,
          send: (o) =>
            authorized({
              method: "GET",
              path: jobPath(params),
              headers: split(params).headers,
              idempotent: true,
              options: o,
            }),
        }),
      cancel: (params, request) =>
        job({
          method: "bulk.cancel",
          args: [params],
          options: request,
          send: (o) =>
            authorized({
              method: "DELETE",
              path: jobPath(params),
              headers: split(params).headers,
              idempotent: true,
              options: o,
            }),
        }),
      results: (params, request) =>
        job<string>({
          method: "bulk.results",
          args: [params],
          options: request,
          send: (o) =>
            base.http({
              bare: vendor,
              method: "GET",
              path: params.downloadUrl,
              headers: { accept: "text/csv" },
              idempotent: true,
              options: o,
            }),
          parse: (response) => response.text(),
        }),
    },
  };
  if (!vendor) return client;
  const token: PreciselyVendorClient["token"] = (request) =>
    job({ method: "token", args: [], options: request, send: (o) => exchange(o) });
  return { ...client, token };
}
