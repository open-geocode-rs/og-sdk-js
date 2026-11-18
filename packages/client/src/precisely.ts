/**
 * The adapter for Precisely's Geo Addressing API.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { precisely } from "@open-geocode/client/precisely";
 * const geo = new Geocoder({
 *   adapter: precisely({ apiKey: "...", apiSecret: "...", defaultCountry: "US" }),
 * });
 * ```
 */
import {
  type Adapter,
  type AdapterBatchItem,
  type AdapterOptions,
  type AdapterResult,
  type BatchContext,
  chunk,
  createTransport,
  emptyAddress,
  type NativeRequest,
  nativeRequest,
  pool,
  text,
} from "./adapter.ts";
import { APIPromise, type RequestOptions, type WithResponse } from "./core.ts";
import { alpha2 } from "./iso.ts";
import { GeocoderError, type GeocoderErrorCode, OgError } from "./errors.ts";
import type {
  Accuracy,
  BaseRequest,
  FieldName,
  Match,
  MatchStatus,
  PlaceRecord,
  PlaceType,
  StructuredAddress,
  TextRange,
} from "./types.ts";

const HOST = "https://api.cloud.precisely.com";

interface PreciselyCommonOptions extends AdapterOptions {
  /** The Geo Addressing host. Default `https://api.cloud.precisely.com`. Precisely also runs regional hosts. */
  baseUrl?: string | undefined;
  /** The host of the token endpoint. Default `https://api.cloud.precisely.com`. */
  authBaseUrl?: string | undefined;
  /** The host of the bulk file flow. Default `https://api.cloud.precisely.com`. */
  bulkBaseUrl?: string | undefined;
  /**
   * The country searched when a call names none, as an ISO 3166-1 code.
   * Precisely needs a country on every request, and `reverse` has no other way to give one.
   */
  defaultCountry?: string | undefined;
}

/** Options for {@link precisely} with an API key and secret. */
export interface PreciselyKeyOptions extends PreciselyCommonOptions {
  apiKey: string;
  apiSecret: string;
  token?: undefined;
}

/** Options for {@link precisely} with a bearer token. */
export interface PreciselyTokenOptions extends PreciselyCommonOptions {
  /** An access token, or a function that answers one. The function is called for every request, so it should cache. */
  token: string | (() => string | Promise<string>);
  apiKey?: undefined;
  apiSecret?: undefined;
}

/** Options for {@link precisely}. */
export type PreciselyOptions = PreciselyKeyOptions | PreciselyTokenOptions;

/** A distance as Precisely writes it. */
export interface PreciselyDistance {
  value?: number;
  distanceUnit?: "FOOT" | "METER" | "MILE" | "KILOMETER";
}

/** The `preferences` object every Precisely operation accepts. */
export interface PreciselyPreferences {
  maxResults?: number;
  returnAllInfo?: boolean;
  factoryDescription?: { label?: string; featureSpecific?: Record<string, string> };
  customPreferences?: Record<string, string>;
  clientLocale?: string | Record<string, unknown>;
  clientCoordSysName?: string;
  distance?: PreciselyDistance;
  streetOffset?: PreciselyDistance;
  cornerOffset?: PreciselyDistance;
  fallbackToGeographic?: boolean;
  fallbackToPostal?: boolean;
  matchMode?: string;
  originXY?: number[];
  returnOfAdditionalFields?: string[];
}

/** An address as Precisely takes it. */
export interface PreciselyAddressInput {
  addressId?: string;
  addressLines?: string[];
  country: string;
  addressNumber?: string;
  street?: string;
  city?: string;
  admin1?: string;
  admin2?: string;
  borough?: string;
  neighborhood?: string;
  suburb?: string;
  postalCode?: string;
  postalCodeExt?: string;
  placeName?: string;
  building?: string;
  floor?: string;
  room?: string;
  unit?: string;
  unitType?: string;
}

/** A named area in a Precisely address. */
export interface PreciselyAdmin {
  longName?: string;
  shortName?: string;
}

/** The address of a Precisely result. */
export interface PreciselyAddress {
  formattedAddress?: string;
  formattedStreetAddress?: string;
  formattedLocationAddress?: string;
  addressNumber?: string;
  street?: string;
  postalCode?: string;
  postalCodeExt?: string;
  placeName?: string;
  building?: string;
  floor?: string;
  room?: string;
  unit?: string;
  unitType?: string;
  country?: {
    name?: string;
    isoAlpha2Code?: string;
    isoAlpha3Code?: string;
    isoNumericCode?: string;
  };
  admin1?: PreciselyAdmin;
  admin2?: PreciselyAdmin;
  city?: PreciselyAdmin;
  borough?: PreciselyAdmin;
  neighborhood?: PreciselyAdmin;
  suburb?: PreciselyAdmin;
}

/** One candidate of a Precisely answer. */
export interface PreciselyResult {
  score?: number;
  address?: PreciselyAddress;
  addressLines?: string[];
  location?: {
    explanation?: {
      type?: string;
      description?: string;
      designation?: string;
      additionalMetadata?: Record<string, string>;
    };
    feature?: {
      type?: string;
      properties?: Record<string, string>;
      geometry?: { type?: string; coordinates?: number[] };
    };
  };
  explanation?: {
    identifier?: string;
    addressMatch?: {
      type?: string;
      description?: {
        label?: string;
        matchType?: string;
        returnType?: string;
        matchedSubstring?: string;
      }[];
    };
    source?: Record<string, string>;
  };
  customFields?: Record<string, string>;
  parsed?: unknown[];
  iso20022?: unknown;
}

/** One suggestion of `/v1/autocomplete`. */
export interface PreciselyPrediction extends PreciselyResult {
  prediction?: string;
  distance?: PreciselyDistance;
}

/** The answer for one address, point or key. */
export interface PreciselyResponse {
  addressId?: string;
  status?: string;
  errorMessage?: string;
  results?: PreciselyResult[];
}

/** The body of a geocode, reverse geocode, lookup or verify answer. */
export interface PreciselyResponses {
  responses?: PreciselyResponse[];
}

/** The body of an autocomplete answer. */
export interface PreciselyAutocompleteResponse {
  response?: { status?: string; errorMessage?: string; predictions?: PreciselyPrediction[] };
}

/** The body `/v1/geocode` and `/v1/verify` take. */
export interface PreciselyAddressesRequest {
  preferences?: PreciselyPreferences;
  addresses: PreciselyAddressInput[];
}

/** The answer of `POST /auth/v2/token`. */
export interface PreciselyToken {
  access_token: string;
  token_type: string;
  /** Seconds the token lasts. */
  expires_in: number;
  scope: string;
}

/** The answer of `POST /v2/files/upload-url`. */
export interface PreciselyUploadUrl {
  fileId: string;
  /** Where to `PUT` the file. Valid for ten minutes. */
  url: string;
  message: string;
}

/** The body `/v2/bulk-geocode` and `/v2/bulk-verify` take. */
export interface PreciselyBulkRequest {
  fileId: string;
  /** One of `,`, `;`, `|` and tab. */
  delimiter?: string;
  preferences?: PreciselyPreferences;
  reportDetails?: {
    listProcessorName?: string;
    listNameId?: string;
    totalList?: string;
    mailingAddress?: string;
    postNumber?: string;
  };
  notifyEmails?: string[];
}

/** The answer to a bulk submission. */
export interface PreciselyBulkSubmission {
  /** Where the job's status is read. Pass it to `bulk.status`. */
  statusUrl: string;
  status?: string | null;
  message?: string | null;
}

/** The state of a bulk job. */
export interface PreciselyJobStatus {
  status:
    | "SCHEDULED"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "CANCELED"
    | "REJECTED"
    | (string & {});
  /** Where the output file is fetched from. Valid for ten minutes. */
  downloadUrl?: string;
  reportUrl?: string;
  message?: string;
  error?: string;
}

/** A scheduled or running bulk job. */
export interface PreciselyQueuedJob {
  jobId: string;
  emailId: string;
  fileId: string;
  fileName: string;
  status: string;
  submittedAt: string;
}

/** Options for a bulk submission. */
export interface PreciselyBulkOptions extends RequestOptions {
  /** Sent as `X-CASS-FLOW`. */
  cassFlow?: "with_report" | "no_report" | undefined;
}

/**
 * Precisely's file flow for large jobs.
 * The layout of its output file is not documented, so it stays outside the unified batch.
 */
export interface PreciselyBulk {
  /** Asks for a file ID and the URL to upload the input file to. */
  uploadUrl(fileName: string, options?: RequestOptions): APIPromise<PreciselyUploadUrl>;
  /** Sends the input file to the URL `uploadUrl` answered. */
  upload(
    url: string,
    content: string,
    options?: RequestOptions & { contentType?: string | undefined },
  ): APIPromise<void>;
  /** Starts a geocode job over an uploaded file. */
  geocode(
    body: PreciselyBulkRequest,
    options?: PreciselyBulkOptions,
  ): APIPromise<PreciselyBulkSubmission>;
  /** Starts a verify job over an uploaded file. */
  verify(
    body: PreciselyBulkRequest,
    options?: PreciselyBulkOptions,
  ): APIPromise<PreciselyBulkSubmission>;
  /** The state of a job, by its ID or by the `statusUrl` of its submission. */
  status(job: string, options?: RequestOptions): APIPromise<PreciselyJobStatus>;
  /** Cancels a job that has not started, by its ID or by the `statusUrl` of its submission. */
  cancel(job: string, options?: RequestOptions): APIPromise<{ jobId: string; message: string }>;
  /** The scheduled and running jobs. */
  jobs(
    status?: "scheduled" | "running" | "all",
    options?: RequestOptions,
  ): APIPromise<{ jobs: PreciselyQueuedJob[] }>;
  /** The uploaded input files. */
  files(options?: RequestOptions): APIPromise<{ results: { fileId: string; fileName: string }[] }>;
  deleteFile(
    fileId: string,
    options?: RequestOptions,
  ): APIPromise<{ status: string; message: string }>;
}

/** Precisely's own API, with the adapter's credentials. */
export interface PreciselyNative {
  /** Any Geo Addressing call. A path is read under `baseUrl`. */
  request: NativeRequest;
  /** Trades the API key and secret for a bearer token. */
  token(options?: RequestOptions): APIPromise<PreciselyToken>;
  /** Address verification, `POST /v1/verify`. */
  verify(body: PreciselyAddressesRequest, options?: RequestOptions): APIPromise<PreciselyResponses>;
  bulk: PreciselyBulk;
}

/** The most addresses, points or keys Precisely takes in one request. */
const BATCH_SIZE = 25;

/** The suggestions asked for when the caller names no limit. Precisely's own default is one, too few to choose from. */
const SUGGESTIONS = 5;

/** The key types `/v1/lookup` takes. A result carries its key in `customFields` under the same name. */
const KEY_TYPES = ["PB_KEY", "GNAF_PID", "UPRN", "UDPRN", "EIR_CODE"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACCURACY: Record<string, Accuracy> = {
  ADDRESS_POINT: "rooftop",
  POI: "rooftop",
  POSTAL_BUILDING: "rooftop",
  ADDRESS_INTERPOLATED: "interpolated",
  INTERSECTION: "street",
  STREET: "street",
  STREET_CENTER: "street",
  STREET_BLOCK: "street",
  POSTAL: "centroid",
  POSTAL_CENTROID: "centroid",
  SUB_TOWN_CENTROID: "centroid",
  TOWN_CENTROID: "centroid",
  ADMIN1: "centroid",
  ADMIN1_CENTROID: "centroid",
  ADMIN2: "centroid",
  ADMIN2_CENTROID: "centroid",
  CITY: "centroid",
  NEIGHBORHOOD: "centroid",
  SUBURB: "centroid",
  COUNTRY: "centroid",
  NEAR_BY_ADDRESS: "approximate",
  PO_BOX: "approximate",
};

/** What a location type says the result is, when the match type does not. */
const LOCATION_TYPES: Record<string, PlaceType> = {
  ADDRESS_POINT: "address",
  ADDRESS_INTERPOLATED: "address",
  NEAR_BY_ADDRESS: "address",
  POSTAL_BUILDING: "address",
  PO_BOX: "address",
  INTERSECTION: "intersection",
  STREET: "street",
  STREET_CENTER: "street",
  STREET_BLOCK: "street",
  POI: "poi",
  POSTAL: "postcode",
  POSTAL_CENTROID: "postcode",
  NEIGHBORHOOD: "neighbourhood",
  SUBURB: "neighbourhood",
  SUB_TOWN_CENTROID: "neighbourhood",
  CITY: "locality",
  TOWN_CENTROID: "locality",
  ADMIN2: "district",
  ADMIN2_CENTROID: "district",
  ADMIN1: "region",
  ADMIN1_CENTROID: "region",
  COUNTRY: "country",
};

const METRES: Record<string, number> = { METER: 1, KILOMETER: 1000, FOOT: 0.3048, MILE: 1609.344 };

const COMPONENTS: Record<string, keyof Match["components"]> = {
  addressNumber: "houseNumber",
  street: "street",
  unitMatch: "unit",
  city: "locality",
  admin2: "district",
  admin1: "region",
  postalCode: "postcode",
};

const MATCHES: Record<string, MatchStatus> = {
  EXACT: "matched",
  ALIAS_EXACT: "matched",
  PARTIAL: "partial",
  ALIAS_PARTIAL: "partial",
  ADDED: "inferred",
  REMOVED: "unmatched",
  NONE: "unmatched",
};

/** The HTTP status that says what a per-item `status` says. */
const HTTP_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  INVALID_CLIENT_INPUT: 400,
  BAD_REQUEST: 400,
  INVALID_TOKEN: 401,
  FORBIDDEN: 403,
  REQUEST_TIMEOUT: 408,
  BATCH_SIZE_EXCEEDED: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  UNKNOWN_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

const STATUS_CODES: Record<string, GeocoderErrorCode> = {
  INVALID_REQUEST: "invalid_request",
  INVALID_CLIENT_INPUT: "invalid_request",
  BAD_REQUEST: "invalid_request",
  INVALID_TOKEN: "unauthenticated",
  FORBIDDEN: "permission_denied",
  REQUEST_TIMEOUT: "timeout",
  BATCH_SIZE_EXCEEDED: "payload_too_large",
  TOO_MANY_REQUESTS: "rate_limited",
  INTERNAL_ERROR: "provider_error",
  UNKNOWN_ERROR: "provider_error",
  SERVICE_UNAVAILABLE: "unavailable",
};

/** Error codes whose meaning neither the HTTP status nor the `status` word is documented to carry. */
const DIS_CODES: Record<string, GeocoderErrorCode> = {
  "DIS-1004": "unauthenticated",
  "DIS-1006": "unauthenticated",
  "DIS-1007": "rate_limited",
};

const GEOCODE_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "address",
  "addressDetails",
  "addressLines",
];

type Operation = "geocode" | "reverse" | "autocomplete" | "lookup";

/** The first entry of Precisely's error envelope, or a failed item, which has the same two fields. */
function envelope(body: unknown): { status?: unknown; errorMessage?: unknown } | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const { errors } = body as { errors?: unknown };
  const first: unknown = Array.isArray(errors) ? errors[0] : body;
  return first !== null && typeof first === "object" ? first : undefined;
}

function describeError(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const { errors, error_description: description } = body as {
    errors?: unknown;
    error_description?: unknown;
  };
  if (Array.isArray(errors)) {
    const messages = errors
      .map((error: unknown) => text((error as { errorMessage?: unknown } | null)?.errorMessage))
      .filter((message) => message !== null);
    if (messages.length > 0) return messages.join(" ");
  }
  // The token endpoint answers in the OAuth error shape.
  return text(description) ?? undefined;
}

/** A per-item failure as the error its `status` stands for. */
function failure(
  item: { status?: string; errorMessage?: string },
  answer: { response: Response; requestId: string | undefined },
): OgError {
  return OgError.fromResponse(
    HTTP_STATUS[item.status ?? ""] ?? 500,
    item,
    answer.response.headers,
    {
      provider: "precisely",
      message: item.errorMessage ?? `Precisely answered ${item.status}.`,
      requestId: answer.requestId,
    },
  );
}

/**
 * The ID `lookup` takes back, as `<KEY_TYPE>:<key>:<country>`.
 * Precisely has no single record ID. `/v1/lookup` wants a key, its type and its country, so the ID carries all three.
 * The country is left out when the record names none. `lookup` then falls back to `defaultCountry`.
 */
function idOf(result: PreciselyResult): string | null {
  for (const type of KEY_TYPES) {
    const key = text(result.customFields?.[type]);
    if (key === null) continue;
    const country =
      text(result.address?.country?.isoAlpha2Code) ?? text(result.address?.country?.isoAlpha3Code);
    return country === null ? `${type}:${key}` : `${type}:${key}:${country}`;
  }
  return null;
}

function decodeId(
  id: string,
): { type: string; key: string; country: string | undefined } | undefined {
  const [type, ...rest] = id.split(":");
  if (!(KEY_TYPES as readonly string[]).includes(type ?? "")) return undefined;
  const last = rest.length > 1 ? rest.at(-1) : undefined;
  const country = last !== undefined && /^[A-Za-z]{2,3}$/.test(last) ? last : undefined;
  const key = (country === undefined ? rest : rest.slice(0, -1)).join(":");
  return key === "" ? undefined : { type: type as string, key, country };
}

function typeOf(match: string | undefined, location: string | undefined): PlaceType {
  const located = LOCATION_TYPES[location ?? ""];
  switch (match) {
    case "ADDRESS":
    case "POBOX":
      return "address";
    case "STREET":
      return located === "intersection" ? "intersection" : "street";
    case "POI":
      return "poi";
    case "NOMATCH":
      return "unknown";
    case "ADMIN":
      // The match type names no tier, so the location type must.
      return located === undefined || ["address", "street", "intersection", "poi"].includes(located)
        ? "unknown"
        : located;
    default:
      return located ?? "unknown";
  }
}

function metres(distance: PreciselyDistance | undefined): number | null {
  const factor = METRES[distance?.distanceUnit ?? ""];
  return typeof distance?.value === "number" && factor !== undefined
    ? distance.value * factor
    : null;
}

/** How far a reverse result lies from the point asked for. */
function reverseDistance(fields: Record<string, string> | undefined): number | null {
  const value = text(fields?.REVERSE_GEOCODE_DISTANCE);
  // Only metres are documented for this field, and another unit is not guessed at.
  if (value === null || fields?.REVERSE_GEOCODE_DISTANCE_UNIT !== "METERS") return null;
  const distance = Number(value);
  return Number.isFinite(distance) ? distance : null;
}

function matchOf(result: PreciselyResult): Match | null {
  const description = result.explanation?.addressMatch?.description;
  if (description === undefined && typeof result.score !== "number") return null;
  const components: Match["components"] = {};
  for (const part of description ?? []) {
    const component = COMPONENTS[part.label ?? ""];
    const status = MATCHES[part.matchType ?? ""];
    if (component !== undefined && status !== undefined) components[component] = status;
  }
  return {
    score: typeof result.score === "number" ? result.score / 100 : null,
    label: null,
    components,
  };
}

/** The typed text found in `label`. A substring that is absent, or there more than once, cannot be placed. */
function highlightsOf(result: PreciselyResult, label: string): TextRange[] | null {
  const ranges: TextRange[] = [];
  for (const part of result.explanation?.addressMatch?.description ?? []) {
    const typed = text(part.matchedSubstring);
    if (typed === null) continue;
    const start = label.indexOf(typed);
    if (start === -1 || label.indexOf(typed, start + 1) !== -1) continue;
    // Kept in reading order, whatever order the parts come in.
    const after = ranges.findIndex((range) => range.start > start);
    ranges.splice(after === -1 ? ranges.length : after, 0, { start, end: start + typed.length });
  }
  return ranges.length === 0 ? null : ranges;
}

function toPlace(
  result: PreciselyPrediction,
  operation: Operation,
  request: Pick<BaseRequest, "focus">,
): PlaceRecord {
  const stated = result.address;
  const coordinates = result.location?.feature?.geometry?.coordinates;
  const [lon, lat] = coordinates ?? [];
  const located = result.location?.explanation?.type;
  const type = typeOf(result.explanation?.addressMatch?.type, located);
  const address = emptyAddress();
  address.houseNumber = text(stated?.addressNumber);
  address.street = text(stated?.street);
  address.unit = text(stated?.unit);
  address.neighbourhood = text(stated?.neighborhood?.longName);
  address.locality = text(stated?.city?.longName);
  address.district = text(stated?.admin2?.longName);
  address.region = text(stated?.admin1?.longName);
  address.regionCode = text(stated?.admin1?.shortName);
  address.postcode = text(stated?.postalCode);
  address.country = text(stated?.country?.name);
  // Predictions carry only the three-letter code, which ISO maps to exactly one two-letter code.
  address.countryCode =
    text(stated?.country?.isoAlpha2Code)?.toUpperCase() ??
    alpha2(stated?.country?.isoAlpha3Code ?? "") ??
    null;
  const lines = result.addressLines?.filter((line) => text(line) !== null) ?? [];
  const label =
    text(result.prediction) ?? text(stated?.formattedAddress) ?? (lines.join(", ") || "");
  const named: Partial<Record<PlaceType, string | null>> = {
    poi: text(stated?.placeName),
    postcode: address.postcode,
    neighbourhood: address.neighbourhood ?? text(stated?.suburb?.longName),
    locality: address.locality,
    district: address.district,
    region: address.region,
    country: address.country,
  };
  const searched = operation === "geocode" || operation === "autocomplete";
  return {
    id: idOf(result),
    type,
    name: named[type] ?? text(stated?.formattedStreetAddress) ?? lines[0] ?? label,
    label,
    location: typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null,
    accuracy: ACCURACY[located ?? ""] ?? null,
    // `score` says how much the input was changed to match, which is not how sure Precisely is.
    confidence: null,
    distance:
      operation === "reverse"
        ? reverseDistance(result.customFields)
        : // Without an origin the suggestion's distance is measured from nothing.
          operation === "autocomplete" && request.focus !== undefined
          ? metres(result.distance)
          : null,
    address,
    addressDetails: {
      unitType: text(stated?.unitType),
      building: text(stated?.building),
      floor: text(stated?.floor),
      // A borough is the official part of a city. A suburb stands in where there is none.
      sublocality: text(stated?.borough?.longName) ?? text(stated?.suburb?.longName),
      postcodeSuffix: text(stated?.postalCodeExt),
    },
    addressLines: lines.length === 0 ? null : lines,
    // Reverse and lookup have no query, and their `score` is always 0.
    match: searched ? matchOf(result) : null,
    highlights: operation === "autocomplete" ? highlightsOf(result, label) : null,
    raw: result,
  };
}

/** A geocode input as Precisely takes it. */
function addressInput(
  item: { query?: string; address?: StructuredAddress },
  country: string,
): PreciselyAddressInput {
  const { address } = item;
  if (address === undefined) return { addressLines: [item.query ?? ""], country };
  return {
    ...(address.address === undefined
      ? {
          ...(address.houseNumber === undefined ? {} : { addressNumber: address.houseNumber }),
          ...(address.street === undefined ? {} : { street: address.street }),
        }
      : { addressLines: [address.address] }),
    ...(address.locality === undefined ? {} : { city: address.locality }),
    ...(address.region === undefined ? {} : { admin1: address.region }),
    ...(address.postcode === undefined ? {} : { postalCode: address.postcode }),
    country,
  };
}

const needsCountry = (operation: string, hint: string): GeocoderError =>
  new GeocoderError(`Precisely needs a country. ${hint}`, {
    code: "invalid_request",
    provider: "precisely",
    operation,
  });

/** The preferences every search shares. */
const preferences = (request: BaseRequest): PreciselyPreferences => ({
  ...(request.limit === undefined ? {} : { maxResults: request.limit }),
  // The lookup key lives in `customFields`, which Precisely documents only with all info returned.
  returnAllInfo: true,
});

/** One item's candidates. Nothing found is an empty answer, and any other status is that item's error. */
function settle(
  item: PreciselyResponse,
  answer: WithResponse<unknown>,
  operation: Operation,
  request: BaseRequest,
): PlaceRecord[] {
  if (item.status === "ZERO_RESULTS") return [];
  if (item.status !== undefined && item.status !== "OK") throw failure(item, answer);
  return (item.results ?? []).map((result) => toPlace(result, operation, request));
}

/** The job ID out of a status URL. A submission answers only the URL, and the documented one names a v1 path. */
const jobId = (job: string): string =>
  encodeURIComponent(job.replace(/\/+$/, "").split("/").pop() ?? "");

const single = (
  answer: WithResponse<PreciselyResponses>,
  operation: Operation,
  request: BaseRequest,
): AdapterResult => ({
  results: (answer.data.responses ?? []).flatMap((item) =>
    settle(item, answer, operation, request),
  ),
  raw: answer.data,
  response: answer.response,
  requestId: answer.requestId,
});

/** The Precisely adapter. Its `native` reaches the rest of Precisely's API. */
export function precisely(options: PreciselyOptions): Adapter<PreciselyNative> {
  const { token } = options;
  const basic = token === undefined ? btoa(`${options.apiKey}:${options.apiSecret}`) : undefined;
  const transport = createTransport(options, {
    name: "precisely",
    baseUrl: options.baseUrl ?? HOST,
    describeError,
  });
  // The upload goes to a storage host, which must not see the headers meant for Precisely.
  const storage = createTransport(
    { ...options, headers: undefined },
    { name: "precisely", baseUrl: "", describeError },
  );
  const authBaseUrl = (options.authBaseUrl ?? HOST).replace(/\/+$/, "");
  const bulkBaseUrl = (options.bulkBaseUrl ?? HOST).replace(/\/+$/, "");

  const authorize = async (call: { headers: Record<string, string> }): Promise<void> => {
    call.headers.authorization =
      token === undefined
        ? `Apikey ${basic}`
        : `Bearer ${typeof token === "string" ? token : await token()}`;
  };
  const send = nativeRequest(transport, authorize);
  const bulkRequest = nativeRequest(transport, authorize, bulkBaseUrl);

  /** A POST that only reads, so a retry may repeat it. */
  const post = <T>(
    path: string,
    body: unknown,
    call: RequestOptions | undefined,
    headers?: Record<string, string>,
  ): Promise<WithResponse<T>> =>
    send<T>({
      ...call,
      path,
      body,
      idempotent: true,
      ...(headers === undefined ? {} : { headers: { ...headers, ...call?.headers } }),
    }).withResponse();

  /** The one country a request searches. */
  function countryOf(request: BaseRequest, operation: string, own?: string): string {
    const { countries } = request;
    if (countries !== undefined && countries.length > 1)
      throw new GeocoderError(
        `Precisely searches one country per request, and \`countries\` names ${countries.length}.`,
        { code: "unsupported", provider: "precisely", operation },
      );
    const country = countries?.[0] ?? text(own) ?? text(options.defaultCountry);
    if (country === null)
      throw needsCountry(
        operation,
        "Pass one entry in `countries`, or set `defaultCountry` on the adapter.",
      );
    return country;
  }

  /** Runs items through a realtime endpoint, 25 to a request. */
  async function batch<Item>(
    operation: "geocode" | "reverse",
    items: readonly Item[],
    context: BatchContext,
    build: (item: Item) => object,
  ): Promise<AdapterBatchItem[]> {
    const path = operation === "geocode" ? "/v1/geocode" : "/v1/reverse-geocode";
    const list = operation === "geocode" ? "addresses" : "locations";
    const answers: AdapterBatchItem[] = [];
    const rows: { index: number; body: object }[] = [];
    items.forEach((item, index) => {
      try {
        rows.push({ index, body: { addressId: String(index), ...build(item) } });
      } catch (error) {
        answers.push({ index, results: [], error });
      }
    });
    let done = answers.length;
    const progress = (count: number): void => {
      done += count;
      context.onProgress(done, items.length);
    };
    if (done > 0) progress(0);
    const chunks = await pool(
      chunk(rows, BATCH_SIZE),
      context.concurrency,
      async (part): Promise<AdapterBatchItem[]> => {
        const answer = await post<PreciselyResponses>(
          path,
          { preferences: preferences(context.request), [list]: part.map((row) => row.body) },
          context.options,
        );
        const responses = answer.data.responses ?? [];
        const byId = new Map(responses.map((item) => [item.addressId, item]));
        const settled = part.map((row, position): AdapterBatchItem => {
          // Answers come back in input order, which stands in when the ID is not echoed.
          const item =
            byId.get(String(row.index)) ??
            (responses[position]?.addressId === undefined ? responses[position] : undefined);
          if (item === undefined)
            return {
              index: row.index,
              results: [],
              error: new OgError("Precisely sent no answer for this item.", {
                provider: "precisely",
                body: answer.data,
                requestId: answer.requestId,
              }),
            };
          try {
            return {
              index: row.index,
              results: settle(item, answer, operation, context.request),
            };
          } catch (error) {
            return { index: row.index, results: [], error };
          }
        });
        progress(part.length);
        return settled;
      },
      (error, part) => {
        progress(part.length);
        return part.map((row) => ({ index: row.index, results: [], error }));
      },
    );
    return [...answers, ...chunks.flat()];
  }

  const submit =
    (path: string) =>
    (
      body: PreciselyBulkRequest,
      call?: PreciselyBulkOptions,
    ): APIPromise<PreciselyBulkSubmission> => {
      const { cassFlow, ...rest } = call ?? {};
      return bulkRequest<PreciselyBulkSubmission>({
        ...rest,
        path,
        body,
        ...(cassFlow === undefined
          ? {}
          : { headers: { "x-cass-flow": cassFlow, ...rest.headers } }),
      });
    };

  const native: PreciselyNative = {
    request: send,
    token(call) {
      if (basic === undefined)
        throw new OgError(
          "A Precisely token is issued for an API key and secret, and this adapter has none.",
          {
            provider: "precisely",
          },
        );
      return new APIPromise<PreciselyToken>(
        transport.send({
          method: "POST",
          path: `${authBaseUrl}/auth/v2/token`,
          body: "grant_type=client_credentials&scope=default",
          headers: {
            authorization: `Basic ${basic}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          idempotent: true,
          options: call,
        }),
        async (response) => (await response.json()) as PreciselyToken,
        (response) => transport.requestId(response.headers),
      );
    },
    verify: (body, call) =>
      send<PreciselyResponses>({ ...call, path: "/v1/verify", body, idempotent: true }),
    bulk: {
      uploadUrl: (fileName, call) =>
        bulkRequest<PreciselyUploadUrl>({
          ...call,
          path: "/v2/files/upload-url",
          body: { fileName },
        }),
      upload: (url, content, call) =>
        new APIPromise<void>(
          storage.send({
            method: "PUT",
            path: url,
            body: content,
            // The URL is signed for a content type, and `text/csv` is what Precisely's own uploader sends.
            headers: { "content-type": call?.contentType ?? "text/csv" },
            idempotent: true,
            options: call,
          }),
          async () => {},
        ),
      geocode: submit("/v2/bulk-geocode"),
      verify: submit("/v2/bulk-verify"),
      status: (job, call) =>
        bulkRequest<PreciselyJobStatus>({ ...call, path: `/v2/bulk/jobs/${jobId(job)}` }),
      cancel: (job, call) =>
        bulkRequest<{ jobId: string; message: string }>({
          ...call,
          method: "DELETE",
          path: `/v2/bulk/jobs/${jobId(job)}`,
          idempotent: true,
        }),
      jobs: (status, call) =>
        bulkRequest<{ jobs: PreciselyQueuedJob[] }>({
          ...call,
          path: "/v2/bulk/jobs",
          query: { status },
        }),
      files: (call) =>
        bulkRequest<{ results: { fileId: string; fileName: string }[] }>({
          ...call,
          path: "/v2/files",
        }),
      deleteFile: (fileId, call) =>
        bulkRequest<{ status: string; message: string }>({
          ...call,
          method: "DELETE",
          path: `/v2/files/${encodeURIComponent(fileId)}`,
          idempotent: true,
        }),
    },
  };

  return {
    id: "precisely",
    native,
    capabilities: {
      geocode: {
        options: ["limit", "countries", "structured"],
        fields: [...GEOCODE_FIELDS, "match"],
      },
      reverse: { options: ["limit", "countries"], fields: [...GEOCODE_FIELDS, "distance"] },
      autocomplete: {
        options: ["limit", "countries", "focus", "session"],
        fields: [...GEOCODE_FIELDS, "distance", "match", "highlights"],
        coordinates: true,
      },
      lookup: { options: [], fields: GEOCODE_FIELDS },
      batch: { geocode: true, reverse: true },
      // What Precisely's terms let a customer keep is not verified, so nothing is kept until it is.
      cache: { maxTtl: 0 },
    },
    async geocode(request, call) {
      const country = countryOf(request, "geocode", request.address?.country);
      const answer = await post<PreciselyResponses>(
        "/v1/geocode",
        {
          preferences: preferences(request),
          addresses: [{ addressId: "0", ...addressInput(request, country) }],
        },
        call,
      );
      return single(answer, "geocode", request);
    },
    async reverse(request, call) {
      const country = countryOf(request, "reverse");
      const answer = await post<PreciselyResponses>(
        "/v1/reverse-geocode",
        {
          preferences: preferences(request),
          locations: [
            { addressId: "0", longitude: request.point.lon, latitude: request.point.lat, country },
          ],
        },
        call,
      );
      return single(answer, "reverse", request);
    },
    async autocomplete(request, call) {
      const country = countryOf(request, "autocomplete");
      const answer = await post<PreciselyAutocompleteResponse>(
        "/v1/autocomplete",
        {
          preferences: {
            ...preferences(request),
            maxResults: request.limit ?? SUGGESTIONS,
            ...(request.focus === undefined
              ? {}
              : { originXY: [request.focus.lon, request.focus.lat] }),
          },
          address: { addressLines: [request.query], country },
        },
        call,
        // Precisely rejects a transaction ID that is not a UUID, so any other session is not sent.
        request.session !== undefined && UUID.test(request.session)
          ? { "x-transaction-id": request.session }
          : undefined,
      );
      const body = answer.data.response ?? {};
      if (body.status !== undefined && body.status !== "OK" && body.status !== "ZERO_RESULTS")
        throw failure(body, answer);
      return {
        results: (body.predictions ?? []).map((result) => toPlace(result, "autocomplete", request)),
        raw: answer.data,
        response: answer.response,
        requestId: answer.requestId,
      };
    },
    async lookup(request, call) {
      const keys: { key: string; type: string; country: string }[] = [];
      for (const id of request.ids) {
        const decoded = decodeId(id);
        // An ID that is not one of ours names no Precisely record.
        if (decoded === undefined) continue;
        const country = decoded.country ?? text(options.defaultCountry);
        if (country === null)
          throw needsCountry(
            "lookup",
            `The ID ${id} names none, so set \`defaultCountry\` on the adapter.`,
          );
        keys.push({ key: decoded.key, type: decoded.type, country });
      }
      const results: PlaceRecord[] = [];
      const bodies: PreciselyResponses[] = [];
      let last: WithResponse<PreciselyResponses> | undefined;
      for (const part of chunk(keys, BATCH_SIZE)) {
        last = await post<PreciselyResponses>(
          "/v1/lookup",
          { preferences: { returnAllInfo: true }, keys: part },
          call,
        );
        bodies.push(last.data);
        results.push(...single(last, "lookup", request).results);
      }
      return {
        results,
        raw: bodies.length === 1 ? bodies[0] : bodies,
        response: last?.response,
        requestId: last?.requestId,
      };
    },
    batch: {
      geocode: (items, context) =>
        batch("geocode", items, context, (item) =>
          addressInput(item, countryOf(context.request, "batch.geocode", item.address?.country)),
        ),
      reverse: (items, context) =>
        batch("reverse", items, context, (item) => ({
          longitude: item.lon,
          latitude: item.lat,
          country: countryOf(context.request, "batch.reverse"),
        })),
    },
    errorCode(error) {
      const first = envelope(error.body);
      const code = /\((DIS-[A-Z0-9-]+)\)/.exec(text(first?.errorMessage) ?? "")?.[1];
      return DIS_CODES[code ?? ""] ?? STATUS_CODES[text(first?.status) ?? ""];
    },
  };
}
