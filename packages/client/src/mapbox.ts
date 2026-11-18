/**
 * A client that speaks Mapbox's own API, Geocoding v6 and Search Box v1.
 * Methods, parameters and answers are Mapbox's, and the JSON comes back as the server sent it.
 *
 * ```ts
 * import { mapbox } from "@open-geocode/client/mapbox";
 *
 * // Ask an og server, which answers in Mapbox's shape under /compat/mapbox.
 * const client = mapbox({ baseUrl: "https://og.example.com" });
 * // Or ask Mapbox itself.
 * const vendor = mapbox({ accessToken: "pk..." });
 *
 * const { features } = await client.geocoding.forward({ q: "2 Avenue de Monte-Carlo" });
 * ```
 */
import { type CacheRule, type APIPromise, type RequestOptions } from "./core.ts";
import { type ClientInfo, type CommonOptions, createBase, type Position } from "./base.ts";
import type { GeocoderErrorCode, OgError } from "./errors.ts";
import type {
  GeocodingBatchParams,
  GeocodingBatchResponse,
  GeocodingForwardParams,
  GeocodingResponse,
  GeocodingReverseParams,
  SearchBoxCategoryParams,
  SearchBoxForwardParams,
  SearchBoxListCategoriesParams,
  SearchBoxListCategoriesResponse,
  SearchBoxResponse,
  SearchBoxRetrieveParams,
  SearchBoxReverseParams,
  SearchBoxSuggestParams,
  SearchBoxSuggestResponse,
} from "./mapbox.types.ts";

export type * from "./mapbox.types.ts";

/** Options for {@link mapbox}. Give `baseUrl` to ask an og server, or `accessToken` to ask Mapbox itself. */
export interface MapboxOptions extends CommonOptions {
  /** An og server. Requests go to `<baseUrl>/compat/mapbox`, and no access token is sent. */
  baseUrl?: string | undefined;
  /** A Mapbox access token, for asking Mapbox itself. It is sent as the `access_token` query parameter. */
  accessToken?: string | undefined;
}

/** Mapbox Geocoding v6. */
export interface MapboxGeocoding {
  /** Finds places by search text, or by an address given part by part. `GET /search/geocode/v6/forward`. */
  forward(params: GeocodingForwardParams, options?: RequestOptions): APIPromise<GeocodingResponse>;
  /** Finds what is at a point. `GET /search/geocode/v6/reverse`. */
  reverse(params: GeocodingReverseParams, options?: RequestOptions): APIPromise<GeocodingResponse>;
  /** Runs many forward and reverse queries in one request. `POST /search/geocode/v6/batch`. */
  batch(params: GeocodingBatchParams, options?: RequestOptions): APIPromise<GeocodingBatchResponse>;
}

/** Mapbox Search Box v1. */
export interface MapboxSearchBox {
  /**
   * Suggests places as the user types. `GET /search/searchbox/v1/suggest`.
   * It is not retried unless `maxRetries` is given, since a retried keystroke is already stale.
   */
  suggest(
    params: SearchBoxSuggestParams,
    options?: RequestOptions,
  ): APIPromise<SearchBoxSuggestResponse>;
  /** Answers the full feature of a suggestion, coordinates included. `GET /search/searchbox/v1/retrieve/{id}`. */
  retrieve(
    params: SearchBoxRetrieveParams,
    options?: RequestOptions,
  ): APIPromise<SearchBoxResponse>;
  /** Searches places and POIs in one request, with no session. `GET /search/searchbox/v1/forward`. */
  forward(params: SearchBoxForwardParams, options?: RequestOptions): APIPromise<SearchBoxResponse>;
  /** Finds what is at a point. `GET /search/searchbox/v1/reverse`. */
  reverse(params: SearchBoxReverseParams, options?: RequestOptions): APIPromise<SearchBoxResponse>;
  /** Finds the POIs of one category. `GET /search/searchbox/v1/category/{canonical_category_id}`. An og server has no such search. */
  category(
    params: SearchBoxCategoryParams,
    options?: RequestOptions,
  ): APIPromise<SearchBoxResponse>;
  /** Lists the categories `category` takes. `GET /search/searchbox/v1/list/category`. An og server has no such list. */
  listCategories(
    params?: SearchBoxListCategoriesParams,
    options?: RequestOptions,
  ): APIPromise<SearchBoxListCategoriesResponse>;
}

/** A client that speaks Mapbox's API. */
export interface MapboxClient extends ClientInfo {
  /** Geocoding v6. */
  geocoding: MapboxGeocoding;
  /** Search Box v1. */
  searchbox: MapboxSearchBox;
}

/**
 * A cache never keeps an answer longer than the vendor allows.
 * Mapbox allows an answer to be stored only when it was asked for with `permanent=true`, which
 * Geocoding v6 alone accepts, and then without limit. Every other answer is for temporary use.
 * See https://docs.mapbox.com/api/search/geocoding/#storing-geocoding-results.
 */
const TEMPORARY: CacheRule = { maxTtl: 0 };
const PERMANENT: CacheRule = { maxTtl: Infinity };

const kept = (params: { permanent?: boolean | undefined }): CacheRule | undefined =>
  params.permanent === true ? PERMANENT : undefined;

function describeError(body: unknown): string | undefined {
  const message = (body as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

function errorCode(error: OgError, method: string): GeocoderErrorCode | undefined {
  // Mapbox answers 422 to a batch that is too long, which the status alone reads as malformed.
  return method === "geocoding.batch" &&
    error.status === 422 &&
    error.message.startsWith("Batch queries must include")
    ? "payload_too_large"
    : undefined;
}

interface Located {
  geometry?: { coordinates?: unknown } | null;
  properties?: { coordinates?: { longitude?: unknown; latitude?: unknown } | null } | null;
}

/** The point of one feature, from its geometry or else from its properties. */
function pointOf(feature: Located | null | undefined): Position | undefined {
  const pair = feature?.geometry?.coordinates;
  const [lon, lat] = Array.isArray(pair)
    ? (pair as unknown[])
    : [feature?.properties?.coordinates?.longitude, feature?.properties?.coordinates?.latitude];
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined;
}

function featuresOf(data: unknown): Located[] {
  const features = (data as { features?: unknown } | null | undefined)?.features;
  return Array.isArray(features) ? (features as Located[]) : [];
}

const present = (point: Position | undefined): point is Position => point !== undefined;

function positions(method: string, data: unknown): Position[] {
  switch (method) {
    case "geocoding.forward":
    case "geocoding.reverse":
    case "searchbox.retrieve":
    case "searchbox.forward":
    case "searchbox.reverse":
    case "searchbox.category":
      return featuresOf(data).map(pointOf).filter(present);
    case "geocoding.batch": {
      const batch = (data as { batch?: unknown } | null | undefined)?.batch;
      // One point per query, that of its best result.
      return (Array.isArray(batch) ? batch : [])
        .map((answer) => pointOf(featuresOf(answer)[0]))
        .filter(present);
    }
    // A suggestion has no coordinates, and a category is not a place.
    default:
      return [];
  }
}

/** Builds a client that speaks Mapbox's API, to an og server or to Mapbox itself. */
export function mapbox(options: MapboxOptions): MapboxClient {
  const base = createBase({
    shape: "mapbox",
    options,
    baseUrl: options.baseUrl,
    credentials: options.accessToken !== undefined,
    vendorUrl: "https://api.mapbox.com",
    cache: TEMPORARY,
    describeError,
    errorCode,
    positions,
  });
  // The access token is Mapbox's own, so it is never sent to og.
  const key = base.server === "og" ? {} : { access_token: options.accessToken };
  const get = (
    path: string,
    query: object,
    request: RequestOptions | undefined,
  ): Promise<Response> =>
    base.http({
      method: "GET",
      path,
      query: { ...query, ...key },
      idempotent: true,
      options: request,
    });

  return {
    shape: base.shape,
    server: base.server,
    geocoding: {
      forward: (params, request) =>
        base.call({
          method: "geocoding.forward",
          args: [params],
          options: request,
          cache: kept(params),
          send: (o) => get("/search/geocode/v6/forward", params, o),
        }),
      reverse: (params, request) =>
        base.call({
          method: "geocoding.reverse",
          args: [params],
          options: request,
          cache: kept(params),
          send: (o) => get("/search/geocode/v6/reverse", params, o),
        }),
      batch: (params, request) =>
        base.call({
          method: "geocoding.batch",
          args: [params],
          options: request,
          cache: kept(params),
          send: (o) =>
            base.http({
              method: "POST",
              path: "/search/geocode/v6/batch",
              query: { permanent: params.permanent, ...key },
              body: JSON.stringify(params.queries),
              headers: { "content-type": "application/json" },
              // A batch only reads, so a retry repeats it safely.
              idempotent: true,
              options: o,
            }),
        }),
    },
    searchbox: {
      suggest: (params, request) =>
        base.call({
          method: "searchbox.suggest",
          args: [params],
          options: request,
          // A retried keystroke is already stale, so a suggestion is asked for once.
          send: (o) => get("/search/searchbox/v1/suggest", params, { maxRetries: 0, ...o }),
        }),
      retrieve: (params, request) => {
        const { id, ...query } = params;
        return base.call({
          method: "searchbox.retrieve",
          args: [params],
          options: request,
          send: (o) => get(`/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`, query, o),
        });
      },
      forward: (params, request) =>
        base.call({
          method: "searchbox.forward",
          args: [params],
          options: request,
          send: (o) => get("/search/searchbox/v1/forward", params, o),
        }),
      reverse: (params, request) =>
        base.call({
          method: "searchbox.reverse",
          args: [params],
          options: request,
          send: (o) => get("/search/searchbox/v1/reverse", params, o),
        }),
      category: (params, request) => {
        const { canonical_category_id: id, ...query } = params;
        return base.call({
          method: "searchbox.category",
          args: [params],
          options: request,
          send: (o) => get(`/search/searchbox/v1/category/${encodeURIComponent(id)}`, query, o),
        });
      },
      listCategories: (params, request) =>
        base.call({
          method: "searchbox.listCategories",
          args: [params],
          options: request,
          send: (o) => get("/search/searchbox/v1/list/category", params ?? {}, o),
        }),
    },
  };
}
