/**
 * The client that speaks Google's Places API (New) v1 and Geocoding API v4.
 * Its methods, requests and responses are Google's own, and the JSON a server answers is returned untouched.
 *
 * ```ts
 * import { google } from "@open-geocode/client/google";
 *
 * // An og server answers, under `/compat/google`. No Google key is needed.
 * const client = google({ baseUrl: "https://og.example.com" });
 * // Or Google itself answers.
 * const client = google({ apiKey: "..." });
 *
 * const { places } = await client.places.searchText({
 *   textQuery: "casino",
 *   fieldMask: ["places.id", "places.displayName", "places.location"],
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
import type { APIPromise, RequestOptions } from "./core.ts";
import { GeocoderError, type GeocoderErrorCode, type OgError } from "./errors.ts";
import type {
  AutocompleteParams,
  AutocompleteResponse,
  ErrorResponse,
  GeocodeAddressParams,
  GeocodeAddressResponse,
  GeocodeLocationParams,
  GeocodeLocationResponse,
  GeocodePlaceParams,
  GeocodeResult,
  GetPhotoMediaParams,
  GetPlaceParams,
  PhotoMedia,
  Place,
  ResponseLatLng,
  SearchDestinationsParams,
  SearchDestinationsResponse,
  SearchNearbyParams,
  SearchNearbyResponse,
  SearchTextParams,
  SearchTextResponse,
} from "./google.types.ts";

export type * from "./google.types.ts";

/** Options for {@link google}. Give `baseUrl` or `apiKey`. */
export interface GoogleOptions extends CommonOptions {
  /** An og server. Requests go to `<baseUrl>/compat/google`, and no key is sent. */
  baseUrl?: string | undefined;
  /** A Google Maps Platform API key, for asking Google itself. It is sent in the `X-Goog-Api-Key` header. */
  apiKey?: string | undefined;
}

/** The client {@link google} builds. */
export interface GoogleClient extends ClientInfo {
  /** Places API (New) v1. */
  places: {
    /** Text Search. `POST /v1/places:searchText`. */
    searchText(params: SearchTextParams, options?: RequestOptions): APIPromise<SearchTextResponse>;
    /**
     * Autocomplete. `POST /v1/places:autocomplete`.
     * A failed request is not retried unless `maxRetries` says so, since the next keystroke has replaced it by then.
     */
    autocomplete(
      params: AutocompleteParams,
      options?: RequestOptions,
    ): APIPromise<AutocompleteResponse>;
    /** Place Details. `GET /v1/places/{placeId}`. */
    get(params: GetPlaceParams, options?: RequestOptions): APIPromise<Place>;
    /** Nearby Search. `POST /v1/places:searchNearby`. */
    searchNearby(
      params: SearchNearbyParams,
      options?: RequestOptions,
    ): APIPromise<SearchNearbyResponse>;
    /**
     * Place Photos. `GET /v1/places/{placeId}/photos/{photoReference}/media`.
     * It asks for the photo's URI with `skipHttpRedirect=true`, and the image itself is loaded from that URI.
     */
    getPhotoMedia(params: GetPhotoMediaParams, options?: RequestOptions): APIPromise<PhotoMedia>;
  };
  /** Geocoding API v4. */
  geocode: {
    /** Geocodes an address. `GET /v4/geocode/address/{addressQuery}`, or `GET /v4/geocode/address` for an address in parts. */
    address(
      params: GeocodeAddressParams,
      options?: RequestOptions,
    ): APIPromise<GeocodeAddressResponse>;
    /** Reverse geocodes a point. `GET /v4/geocode/location/{locationQuery}`, or `GET /v4/geocode/location` for a point in parts. */
    location(
      params: GeocodeLocationParams,
      options?: RequestOptions,
    ): APIPromise<GeocodeLocationResponse>;
    /**
     * Geocodes a place ID. `GET /v4/geocode/places/{placeId}`.
     * The answer is one bare result, with no `results` list around it.
     */
    place(params: GeocodePlaceParams, options?: RequestOptions): APIPromise<GeocodeResult>;
    /**
     * Finds the destinations at a place ID, an address or a point. `POST /v4/geocode/destinations`.
     * Several destinations come back when the query can be read more than one way.
     */
    destinations(
      params: SearchDestinationsParams,
      options?: RequestOptions,
    ): APIPromise<SearchDestinationsResponse>;
  };
}

const PLACES_URL = "https://places.googleapis.com";
const GEOCODE_URL = "https://geocode.googleapis.com";

/**
 * A cache never keeps an answer longer than the server that gave it allows.
 * Google allows its coordinates to be kept for 30 days.
 * See https://developers.google.com/maps/documentation/geocoding/policies.
 */
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** The code of each `error.status`. Several share an HTTP status, so the status alone misreads them. */
const ERRORS: ReadonlyMap<string, GeocoderErrorCode> = new Map<string, GeocoderErrorCode>([
  ["INVALID_ARGUMENT", "invalid_request"],
  ["FAILED_PRECONDITION", "invalid_request"],
  ["OUT_OF_RANGE", "invalid_request"],
  ["UNAUTHENTICATED", "unauthenticated"],
  ["PERMISSION_DENIED", "permission_denied"],
  ["NOT_FOUND", "not_found"],
  ["ALREADY_EXISTS", "conflict"],
  ["ABORTED", "conflict"],
  ["RESOURCE_EXHAUSTED", "rate_limited"],
  ["UNIMPLEMENTED", "unsupported"],
  ["UNAVAILABLE", "unavailable"],
  ["DEADLINE_EXCEEDED", "timeout"],
  ["CANCELLED", "aborted"],
  ["INTERNAL", "provider_error"],
  ["UNKNOWN", "provider_error"],
  ["DATA_LOSS", "provider_error"],
]);

function failure(body: unknown): ErrorResponse["error"] {
  return body !== null && typeof body === "object" ? (body as ErrorResponse).error : undefined;
}

function describeError(body: unknown): string | undefined {
  const message = failure(body)?.message;
  return typeof message === "string" && message !== "" ? message : undefined;
}

function errorCode(error: OgError): GeocoderErrorCode | undefined {
  const failed = failure(error.body);
  // A rejected key answers 400 INVALID_ARGUMENT, which would read as a malformed request.
  if (
    Array.isArray(failed?.details) &&
    failed.details.some((detail) => detail?.reason === "API_KEY_INVALID")
  )
    return "unauthenticated";
  return ERRORS.get(failed?.status ?? "");
}

/** The point of one place or result. A coordinate proto3 JSON left out is zero. */
function point(holder: { location?: ResponseLatLng } | null | undefined): Position[] {
  const location = holder?.location;
  if (location === null || typeof location !== "object") return [];
  return [{ lat: location.latitude ?? 0, lon: location.longitude ?? 0 }];
}

function points(list: readonly { location?: ResponseLatLng }[] | undefined): Position[] {
  return Array.isArray(list) ? list.flatMap(point) : [];
}

/** Autocomplete answers with no points, so it has none to give. */
function positions(method: string, data: unknown): Position[] {
  if (data === null || typeof data !== "object") return [];
  switch (method) {
    case "places.searchText":
    case "places.searchNearby":
      return points((data as SearchTextResponse).places);
    case "geocode.address":
    case "geocode.location":
      return points((data as GeocodeAddressResponse).results);
    case "places.get":
    case "geocode.place":
      return point(data as Place);
    case "geocode.destinations": {
      const destinations = (data as SearchDestinationsResponse).destinations;
      return Array.isArray(destinations)
        ? destinations.flatMap((destination) => point(destination?.primary))
        : [];
    }
    default:
      return [];
  }
}

/** The field mask as its header. Paths are joined with commas and no spaces, as Google reads them. */
function masked(fieldMask: readonly string[] | undefined): Record<string, string> {
  return fieldMask === undefined || fieldMask.length === 0
    ? {}
    : { "X-Goog-FieldMask": fieldMask.join(",") };
}

/**
 * Query parameters as Google's REST transcoding reads them.
 * A message field becomes dotted names, and a repeated field repeats its key.
 */
function toQuery(fields: Record<string, unknown>): URLSearchParams {
  const search = new URLSearchParams();
  const add = (name: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) for (const item of value) add(name, item);
    else if (typeof value === "object")
      for (const [key, inner] of Object.entries(value)) add(`${name}.${key}`, inner);
    else search.append(name, String(value));
  };
  for (const [name, value] of Object.entries(fields)) add(name, value);
  return search;
}

/**
 * A text as one path segment, or `undefined` for a text that cannot be one.
 * An empty segment, `.` and `..` are rewritten when a URL is parsed, so the request would reach another path.
 */
function segment(text: string): string | undefined {
  if (text === "" || text === "." || text === "..") return undefined;
  // A comma is legal in a path and Google's own URLs keep it, so `lat,lng` stays readable.
  return encodeURIComponent(text).replace(/%2C/g, ",");
}

/** The forms of resource name a method takes. */
const RESOURCES = {
  place: { pattern: /^places\/[^/]+$/, form: "places/{placeId}" },
  photoMedia: {
    pattern: /^places\/[^/]+\/photos\/[^/]+\/media$/,
    form: "places/{placeId}/photos/{photoReference}/media",
  },
} as const;

/** A resource name such as `places/{placeId}` as a path, each of its parts encoded. */
function resource(
  name: string,
  field: string,
  method: string,
  kind: keyof typeof RESOURCES = "place",
): string {
  const { pattern, form } = RESOURCES[kind];
  const parts = name.split("/").map(segment);
  if (!pattern.test(name) || parts.includes(undefined))
    throw new GeocoderError(
      `\`${field}\` must be a resource name of the form \`${form}\`, and it is ${JSON.stringify(name)}.`,
      { code: "invalid_request", operation: method, provider: "google" },
    );
  return parts.join("/");
}

/**
 * Builds a client that speaks Google's Places API (New) and Geocoding API v4.
 * With `baseUrl` an og server answers, and with `apiKey` alone Google does.
 */
export function google(options: GoogleOptions): GoogleClient {
  const base = createBase({
    shape: "google",
    options,
    baseUrl: options.baseUrl,
    credentials: options.apiKey !== undefined,
    // Google serves the two APIs from two hosts, so there is no one root. og serves both under one.
    ...(options.apiKey === undefined
      ? {}
      : { vendorHeaders: { "X-Goog-Api-Key": options.apiKey } }),
    cache: { maxTtl: THIRTY_DAYS },
    describeError,
    errorCode,
    positions,
  });
  const places = base.server === "og" ? "" : PLACES_URL;
  const geocode = base.server === "og" ? "" : GEOCODE_URL;

  /**
   * A POST whose body is the request without its field mask. The searches change nothing, so a retry is safe.
   * `url` is the host and path, since the two APIs have two hosts.
   */
  function post<T>(
    method: string,
    url: string,
    params: { fieldMask?: readonly string[] | undefined },
    call: RequestOptions | undefined,
    defaults?: RequestOptions,
  ): APIPromise<T> {
    const { fieldMask, ...body } = params;
    const step: Step<T> = {
      method,
      args: [params],
      options: call,
      send: (o) =>
        base.http({
          method: "POST",
          path: url,
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", ...masked(fieldMask) },
          idempotent: true,
          options: defaults === undefined ? o : { ...defaults, ...o },
        }),
    };
    return base.call(step);
  }

  function get<T>(
    method: string,
    params: unknown,
    url: () => { path: string; query: Record<string, unknown> },
    fieldMask: readonly string[] | undefined,
    call: RequestOptions | undefined,
  ): APIPromise<T> {
    const step: Step<T> = {
      method,
      args: [params],
      options: call,
      send: async (o) => {
        const { path, query } = url();
        return base.http({
          method: "GET",
          path,
          query: toQuery(query),
          headers: masked(fieldMask),
          idempotent: true,
          options: o,
        });
      },
    };
    return base.call(step);
  }

  return {
    shape: base.shape,
    server: base.server,
    places: {
      searchText: (params, call) =>
        post("places.searchText", `${places}/v1/places:searchText`, params, call),
      autocomplete: (params, call) =>
        // A retried keystroke is already stale.
        post("places.autocomplete", `${places}/v1/places:autocomplete`, params, call, {
          maxRetries: 0,
        }),
      get: (params, call) => {
        const { name, fieldMask, ...query } = params;
        return get(
          "places.get",
          params,
          () => ({ path: `${places}/v1/${resource(name, "name", "places.get")}`, query }),
          fieldMask,
          call,
        );
      },
      searchNearby: (params, call) =>
        post("places.searchNearby", `${places}/v1/places:searchNearby`, params, call),
      getPhotoMedia: (params, call) => {
        const { name, ...query } = params;
        return get(
          "places.getPhotoMedia",
          params,
          () => ({
            path: `${places}/v1/${resource(name, "name", "places.getPhotoMedia", "photoMedia")}`,
            // Without it the answer is a redirect to the image, which is no JSON to read.
            query: { ...query, skipHttpRedirect: true },
          }),
          undefined,
          call,
        );
      },
    },
    geocode: {
      address: (params, call) => {
        const { fieldMask, addressQuery, ...rest } = params;
        const inPath = addressQuery === undefined ? undefined : segment(addressQuery);
        return get(
          "geocode.address",
          params,
          () =>
            inPath === undefined
              ? // A text that cannot be a path segment goes in the query, which Google reads the same way.
                { path: `${geocode}/v4/geocode/address`, query: { addressQuery, ...rest } }
              : { path: `${geocode}/v4/geocode/address/${inPath}`, query: rest },
          fieldMask,
          call,
        );
      },
      location: (params, call) => {
        const { fieldMask, locationQuery, ...rest } = params;
        const inPath = locationQuery === undefined ? undefined : segment(locationQuery);
        return get(
          "geocode.location",
          params,
          () =>
            inPath === undefined
              ? { path: `${geocode}/v4/geocode/location`, query: { locationQuery, ...rest } }
              : { path: `${geocode}/v4/geocode/location/${inPath}`, query: rest },
          fieldMask,
          call,
        );
      },
      place: (params, call) => {
        const { place, fieldMask, ...query } = params;
        return get(
          "geocode.place",
          params,
          () => ({
            path: `${geocode}/v4/geocode/${resource(place, "place", "geocode.place")}`,
            query,
          }),
          fieldMask,
          call,
        );
      },
      destinations: (params, call) =>
        post("geocode.destinations", `${geocode}/v4/geocode/destinations`, params, call),
    },
  };
}
