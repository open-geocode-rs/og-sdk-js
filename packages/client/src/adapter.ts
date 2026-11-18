/**
 * The contract an adapter implements, and the helpers every adapter shares.
 * An adapter translates one provider's API to the unified format and nothing else.
 * Retries, timeouts, plugins and the bookkeeping of unavailable fields belong to the `Geocoder`.
 */
import {
  APIPromise,
  type Logger,
  type LogLevel,
  type RequestOptions,
  Transport,
  type TransportOptions,
} from "./core.ts";
import { APIUserAbortError, type GeocoderErrorCode, type OgError } from "./errors.ts";
import type {
  Address,
  Attribution,
  AutocompleteRequest,
  BaseRequest,
  BatchGeocodeInput,
  BatchReverseInput,
  FieldName,
  GeocodeRequest,
  LatLon,
  LookupRequest,
  Operation,
  OptionName,
  PlaceRecord,
  PlacesRequest,
  ProviderId,
  ReverseRequest,
  StructuredAddress,
} from "./types.ts";

/**
 * How long a provider's answers may be kept.
 * A cache never keeps an answer longer than its provider allows.
 */
export interface CacheRule {
  /** Milliseconds an answer may be kept. `0` means never, and `Infinity` means there is no limit. */
  maxTtl: number;
}

/** What one operation of an adapter supports. */
export interface OperationCapabilities {
  /** The cache rule of this operation, where it differs from the adapter's own. */
  cache?: CacheRule;
  /** The request options the provider honours. Any other is left out and reported in `ignored`. */
  options: readonly OptionName[];
  /** The fields the provider can fill. Any other is `null` and reported in `unavailable`. */
  fields: readonly FieldName[];
}

/** What an adapter supports. An operation it lacks is absent. */
export interface AdapterCapabilities {
  geocode?: OperationCapabilities;
  reverse?: OperationCapabilities;
  /** `coordinates` is `false` when suggestions carry no location and need a `lookup`. */
  autocomplete?: OperationCapabilities & { coordinates: boolean };
  places?: OperationCapabilities;
  lookup?: OperationCapabilities;
  /** The batch operations the provider runs itself. Any other is emulated with single calls. */
  batch?: { geocode?: boolean; reverse?: boolean };
  /**
   * How long the provider's answers may be kept, for every operation that states no rule of its own.
   * An adapter that states none is treated as one whose answers may never be kept.
   */
  cache?: CacheRule;
}

/** The cache rule that holds for one operation of an adapter. */
export function cacheRule(capabilities: AdapterCapabilities, operation: Operation): CacheRule {
  return capabilities[operation]?.cache ?? capabilities.cache ?? { maxTtl: 0 };
}

/** What an adapter returns for one call. */
export interface AdapterResult {
  results: PlaceRecord[];
  /** Credits the provider asks to be shown. */
  attribution?: Attribution[];
  /** The provider's response body, untouched. */
  raw: unknown;
  /** The HTTP response. When a call took several, the last one. */
  response: Response | undefined;
  requestId?: string | undefined;
}

/** One item of a native batch, as an adapter answers it. */
export interface AdapterBatchItem {
  index: number;
  results: PlaceRecord[];
  /** What failed, as thrown. The `Geocoder` turns it into a `GeocoderError`. */
  error?: unknown;
}

/** What a native batch receives besides its items. */
export interface BatchContext {
  /** Options shared by every item. */
  request: BaseRequest;
  options: RequestOptions | undefined;
  concurrency: number;
  pollInterval: number;
  onProgress: (done: number, total: number) => void;
}

/** One item of a geocode batch, normalised. */
export interface BatchGeocodeItem {
  id?: string;
  query?: string;
  address?: StructuredAddress;
}

/** A provider adapter. Build one with `og()`, `google()`, `mapbox()`, `here()` or `precisely()`. */
export interface Adapter<Native = unknown> {
  readonly id: ProviderId;
  readonly capabilities: AdapterCapabilities;
  /** The provider's own API, with the adapter's credentials and the shared retries and timeouts. */
  readonly native: Native;
  geocode?(request: GeocodeRequest, options?: RequestOptions): Promise<AdapterResult>;
  reverse?(request: ReverseRequest, options?: RequestOptions): Promise<AdapterResult>;
  autocomplete?(request: AutocompleteRequest, options?: RequestOptions): Promise<AdapterResult>;
  places?(request: PlacesRequest, options?: RequestOptions): Promise<AdapterResult>;
  lookup?(request: LookupRequest, options?: RequestOptions): Promise<AdapterResult>;
  batch?: {
    geocode?(items: BatchGeocodeItem[], context: BatchContext): Promise<AdapterBatchItem[]>;
    reverse?(items: BatchReverseInput[], context: BatchContext): Promise<AdapterBatchItem[]>;
  };
  /** Reads a provider error the HTTP status alone would misread. */
  errorCode?(error: OgError, operation: Operation | "batch"): GeocoderErrorCode | undefined;
}

/** Options every adapter accepts. */
export interface AdapterOptions {
  /** Headers sent with every request, for example your gateway's auth header. */
  headers?: Record<string, string> | undefined;
  /** A custom `fetch`. Defaults to the global one. */
  fetch?: typeof globalThis.fetch | undefined;
  /** Milliseconds before a request fails. Default 60000. */
  timeout?: number | undefined;
  /** Times a failed request is retried, with exponential backoff. Default 2. `autocomplete` never retries unless asked. */
  maxRetries?: number | undefined;
  /** How much to log. Default `"warn"`. */
  logLevel?: LogLevel | undefined;
  /** Where to log. Default `console`. */
  logger?: Logger | undefined;
}

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

/** Builds the transport an adapter sends its requests through. */
export function createTransport(
  options: AdapterOptions,
  provider: Pick<TransportOptions, "name" | "describeError" | "requestIdHeaders"> & {
    baseUrl: string;
  },
): Transport {
  return new Transport({
    ...provider,
    baseUrl: provider.baseUrl.replace(/\/+$/, ""),
    headers: options.headers ?? {},
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    timeout: options.timeout ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
    logLevel: options.logLevel ?? "warn",
    logger: options.logger ?? (typeof console === "undefined" ? silent : console),
  });
}

/** A call to a provider's own API. */
export interface NativeCall extends RequestOptions {
  /** Default `GET`, or `POST` when there is a `body`. */
  method?: "GET" | "POST" | "PUT" | "DELETE" | undefined;
  /** A path under the provider's host, or an absolute URL. */
  path: string;
  query?: Record<string, unknown> | URLSearchParams | undefined;
  /** Sent as JSON. */
  body?: unknown;
  /** Whether a retry may repeat the call. Default `true` for `GET`, else `false`. */
  idempotent?: boolean | undefined;
}

/** Sends any request to a provider with the adapter's credentials, and parses the JSON answer. */
export type NativeRequest = <T = unknown>(call: NativeCall) => APIPromise<T>;

/** Builds an adapter's `native.request`. `authorize` adds the provider's credentials to each call. */
export function nativeRequest(
  transport: Transport,
  authorize: (call: {
    query: URLSearchParams;
    headers: Record<string, string>;
  }) => void | Promise<void>,
  baseUrl?: string,
): NativeRequest {
  return <T>(call: NativeCall): APIPromise<T> => {
    const send = async (): Promise<Response> => {
      const query =
        call.query instanceof URLSearchParams
          ? new URLSearchParams(call.query)
          : toParams(call.query ?? {});
      const headers: Record<string, string> = {};
      await authorize({ query, headers });
      const method = call.method ?? (call.body === undefined ? "GET" : "POST");
      const absolute = /^https?:\/\//.test(call.path);
      return transport.send({
        method,
        path: absolute || baseUrl === undefined ? call.path : `${baseUrl}${call.path}`,
        query,
        ...(call.body === undefined
          ? { headers }
          : {
              body: JSON.stringify(call.body),
              headers: { "content-type": "application/json", ...headers },
            }),
        idempotent: call.idempotent ?? method === "GET",
        options: call,
      });
    };
    return new APIPromise<T>(
      send(),
      async (response) => (response.status === 204 ? undefined : await response.json()) as T,
      (response) => transport.requestId(response.headers),
    );
  };
}

/** Query parameters from an object. `undefined` and `null` are left out, and an array repeats its key. */
export function toParams(query: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else params.set(key, String(value));
  }
  return params;
}

/** An address with every part `null`, for an adapter to fill. */
export function emptyAddress(): Address {
  return {
    houseNumber: null,
    street: null,
    unit: null,
    neighbourhood: null,
    locality: null,
    district: null,
    region: null,
    regionCode: null,
    postcode: null,
    country: null,
    countryCode: null,
  };
}

/** `value` when it is a non-empty string, else `null`. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** House number and street as one line, from a structured address. */
export function streetLine(address: StructuredAddress): string | undefined {
  if (address.address !== undefined) return address.address;
  const line = [address.houseNumber, address.street].filter(Boolean).join(" ");
  return line === "" ? undefined : line;
}

/** A structured address as one line of free text, for a provider with no structured input. */
export function oneLine(address: StructuredAddress): string {
  return [streetLine(address), address.locality, address.region, address.postcode, address.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * Minutes a timezone is ahead of UTC at `at`, from the runtime's own timezone rules.
 * `null` when the runtime does not know the zone.
 */
export function utcOffsetMinutes(zone: string, at: Date = new Date()): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    }).formatToParts(at);
    const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    if (offset === "GMT") return 0;
    const found = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset);
    if (!found) return null;
    const minutes = Number(found[2]) * 60 + Number(found[3] ?? 0);
    return found[1] === "-" ? -minutes : minutes;
  } catch {
    return null;
  }
}

/**
 * Ranges counted in Unicode characters, as ranges into a JavaScript string,
 * where a character outside the basic plane takes two units.
 */
export function toStringRanges(
  label: string,
  ranges: readonly { start: number; end: number }[],
): { start: number; end: number }[] {
  const units: number[] = [0];
  for (const char of label) units.push((units.at(-1) as number) + char.length);
  const last = units.length - 1;
  return ranges.map((range) => ({
    start: units[Math.min(range.start, last)] as number,
    end: units[Math.min(range.end, last)] as number,
  }));
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance between two points, in metres. */
export function distance(a: LatLon, b: LatLon): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Resolves after `ms`, or rejects when `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new APIUserAbortError("Request was aborted."));
      return;
    }
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
}

/**
 * Runs `task` over `items` with at most `concurrency` in flight, and returns the answers in input order.
 * A task that throws does not stop the others. Its error is passed to `onError`, which answers for it.
 */
export async function pool<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  onError: (error: unknown, item: T, index: number) => R,
  onDone?: (done: number, total: number) => void,
): Promise<R[]> {
  const answers: R[] = Array.from({ length: items.length });
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index] as T;
      try {
        answers[index] = await task(item, index);
      } catch (error) {
        answers[index] = onError(error, item, index);
      }
      onDone?.(++done, items.length);
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return answers;
}

/** Splits `items` into runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    chunks.push(items.slice(start, start + size));
  return chunks;
}

/** One batch input as an adapter receives it. */
export function batchItem(input: BatchGeocodeInput): BatchGeocodeItem {
  if (typeof input === "string") return { query: input };
  if ("query" in input || "id" in input) {
    const item = input as { id?: string; query?: string; address?: StructuredAddress };
    const out: BatchGeocodeItem = {};
    if (item.id !== undefined) out.id = item.id;
    if (item.query !== undefined) out.query = item.query;
    else if (item.address !== undefined) out.address = item.address;
    return out;
  }
  const item = input as StructuredAddress | { address?: StructuredAddress };
  // `{ address: {...} }` wraps a structured address, while `{ address: "..." }` is one.
  return typeof item.address === "object"
    ? { address: item.address }
    : { address: item as StructuredAddress };
}
