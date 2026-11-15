/**
 * The adapter for HERE Geocoding and Search v7 and the HERE Batch API v7.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { here } from "@open-geocode/client/here";
 * const geo = new Geocoder({ adapter: here({ apiKey: "..." }) });
 * ```
 */
import {
  type Adapter,
  type AdapterBatchItem,
  type AdapterOptions,
  type AdapterResult,
  type BatchContext,
  createTransport,
  emptyAddress,
  type NativeCall,
  nativeRequest,
  type OperationCapabilities,
  pool,
  sleep,
  streetLine,
  text,
  toParams,
} from "./adapter.ts";
import { APIPromise, type RequestOptions } from "./core.ts";
import { BadRequestError, GeocoderError, NotFoundError, OgError } from "./errors.ts";
import { alpha2, alpha3 } from "./iso.ts";
import type {
  Accuracy,
  BaseRequest,
  FieldName,
  Include,
  LatLon,
  Match,
  MatchStatus,
  OptionName,
  PlaceRecord,
  PlaceType,
  StructuredAddress,
  TextRange,
} from "./types.ts";

/** A HERE host. Each one is `https://{service}.search.hereapi.com`. */
export type HereService =
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

/** Options for {@link here}. */
export interface HereOptions extends AdapterOptions {
  /** Sent as the `apiKey` query parameter. */
  apiKey?: string | undefined;
  /**
   * Sent as `Authorization: Bearer` in place of the key.
   * A function is called for every request, so it can hand out a fresh token when the last one expired.
   */
  bearerToken?: string | (() => string | Promise<string>) | undefined;
  /**
   * Where each HERE host is reached, for a proxy or a test.
   * A value replaces the host and the version, such as `https://geocode.search.hereapi.com/v1`.
   */
  baseUrls?: Partial<Record<HereService, string>> | undefined;
}

/** A call to HERE's own API. A relative `path` needs the `service` whose host it is under. */
export type HereCall = NativeCall & { service?: HereService | undefined };

/** What a Batch API job is created with. */
export interface HereJobParams {
  /** The endpoint every record of the job is sent to. */
  service: "geocode" | "revgeocode" | "lookup";
  inputDelimiter?: string | undefined;
  outputDelimiter?: string | undefined;
  inputColumns?: string | undefined;
  outputColumns?: string | undefined;
  /** Comma-separated JSON paths to keep, for `jsonl` output. */
  outputFilter?: string | undefined;
  outputType?: "csv" | "jsonl" | undefined;
  /** Default `true` on HERE's side. */
  startJob?: boolean | undefined;
  tag?: string | undefined;
  billingTags?: string | undefined;
  notificationIds?: string | undefined;
}

/** What HERE answers to a job action. */
export interface HereJob {
  id: string;
  serviceHrn: string;
  tag?: string;
  billingTags?: string[];
  status: HereJobState;
  href?: string;
}

/** The states of a Batch API job. */
export type HereJobState =
  | "submitted"
  | "queued"
  | "pending"
  | "inProgress"
  | "completed"
  | "stopped"
  | "deleted"
  | "failure"
  | (string & {});

/** A job with its progress. */
export interface HereJobStatus extends HereJob {
  created?: string;
  started?: string;
  ended?: string;
  records?: {
    total?: number;
    valid?: number;
    invalid?: number;
    processed?: number;
    pending?: number;
    succeeded?: number;
    failed?: number;
  };
  /** Empty when the job has no results. */
  resultsHref?: string;
  /** Empty when the job has no errors. */
  errorsHref?: string;
  outputType?: string;
}

/** HERE's own API, with the adapter's credentials and the shared retries and timeouts. */
export interface HereNative {
  /** Any HERE request. Give an absolute URL, or a path with its `service`, such as `/browse` on `browse`. */
  request<T = unknown>(call: HereCall): APIPromise<T>;
  /** The Batch API v7 job calls. */
  batch: {
    /** Uploads `input`, one record per line, as a new job. */
    create(input: string, params: HereJobParams, options?: RequestOptions): Promise<HereJob>;
    /** Starts a job, or resumes a stopped one. */
    start(id: string, options?: RequestOptions): Promise<HereJob>;
    status(id: string, options?: RequestOptions): Promise<HereJobStatus>;
    /** The results file as text. Empty when the job has none. */
    results(id: string, options?: RequestOptions): Promise<string>;
    /** The error report as text. Empty when the job has none. */
    errors(id: string, options?: RequestOptions): Promise<string>;
    /** Halts a job. What it has finished stays downloadable. */
    stop(id: string, options?: RequestOptions): Promise<HereJob>;
    delete(id: string, options?: RequestOptions): Promise<HereJob>;
  };
}

interface HereAddress {
  label?: string;
  countryCode?: string;
  countryName?: string;
  stateCode?: string;
  state?: string;
  county?: string;
  city?: string;
  district?: string;
  subdistrict?: string;
  street?: string;
  postalCode?: string;
  houseNumber?: string;
  building?: string;
  unit?: string;
}

interface HerePoint {
  lat: number;
  lng: number;
  type?: string;
}

interface HereRange {
  start: number;
  end: number;
}

interface HereContactValue {
  value?: string;
}

interface HereContacts {
  phone?: HereContactValue[];
  www?: HereContactValue[];
  email?: HereContactValue[];
}

interface HereFieldScore {
  country?: number;
  countryCode?: number;
  state?: number;
  stateCode?: number;
  county?: number;
  countyCode?: number;
  city?: number;
  streets?: number[];
  houseNumber?: number;
  postalCode?: number;
  unit?: number;
}

/** The parts of a HERE result item this adapter reads, across every endpoint. */
interface HereItem {
  title: string;
  id: string;
  resultType?: string;
  houseNumberType?: string;
  localityType?: string;
  administrativeAreaType?: string;
  estimatedPointAddress?: boolean;
  closedPermanently?: string;
  address?: HereAddress;
  position?: HerePoint;
  access?: HerePoint[];
  distance?: number;
  mapView?: { west: number; south: number; east: number; north: number };
  categories?: { id?: string; name?: string; primary?: boolean }[];
  chains?: { id?: string; name?: string }[];
  contacts?: HereContacts[];
  openingHours?: { text?: string[]; isOpen?: boolean }[];
  timeZone?: { name?: string; utcOffset?: string };
  scoring?: { queryScore?: number; fieldScore?: HereFieldScore };
  streetInfo?: { baseName?: string; streetType?: string; prefix?: string; suffix?: string }[];
  countryInfo?: { alpha2?: string };
  secondaryUnitInfo?: { normalizedUnitType?: string }[];
  highlights?: { title?: HereRange[]; address?: { label?: HereRange[] } };
}

interface HereItems {
  items?: HereItem[];
}

/** The error bodies of both APIs. The Batch API answers 401 and 403 in a shape of their own. */
interface HereErrorBody {
  title?: unknown;
  cause?: unknown;
  action?: unknown;
  code?: unknown;
  error_description?: unknown;
  jobRecord?: unknown;
}

/** One line of a job's JSONL results. */
interface JobLine {
  recId?: string;
  results?: HereItem[];
}

const SEARCH_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "distance",
  "address",
  "bbox",
  "addressDetails",
  "streetParts",
  "categories",
  "timezone",
  "accessPoints",
];
const POI_FIELDS: readonly FieldName[] = ["brand", "contact", "openingHours"];
const SEARCH: readonly OptionName[] = [
  "limit",
  "language",
  "countries",
  "focus",
  "bounds",
  "types",
];

const CAPABILITIES: {
  geocode: OperationCapabilities;
  reverse: OperationCapabilities;
  autocomplete: OperationCapabilities & { coordinates: boolean };
  places: OperationCapabilities;
  lookup: OperationCapabilities;
  batch: { geocode: boolean; reverse: boolean };
} = {
  geocode: {
    // `in` takes only country codes on `/geocode`, so `bounds` cannot be sent.
    options: ["limit", "language", "countries", "focus", "types", "structured"],
    fields: [...SEARCH_FIELDS, "confidence", "match"],
  },
  reverse: { options: ["limit", "language", "types"], fields: SEARCH_FIELDS },
  // `/autocomplete` items have no position, so a suggestion may need a `lookup`.
  autocomplete: {
    options: SEARCH,
    fields: [...SEARCH_FIELDS, ...POI_FIELDS, "highlights"],
    coordinates: false,
  },
  places: { options: SEARCH, fields: [...SEARCH_FIELDS, ...POI_FIELDS] },
  lookup: {
    options: ["language"],
    fields: [
      ...SEARCH_FIELDS.filter((field) => field !== "distance"),
      ...POI_FIELDS,
      "businessStatus",
    ],
  },
  batch: { geocode: true, reverse: true },
};

/** The `show` values each `include` field needs. `always` is asked for wherever the endpoint has it. */
const SHOW: readonly (readonly [value: string, needs: readonly Include[] | "always"])[] = [
  // HERE's own alpha-2 code, which also covers the codes of its own that ISO does not list.
  ["countryInfo", "always"],
  ["details", ["contact", "openingHours"]],
  ["secondaryUnitInfo", ["addressDetails"]],
  ["streetInfo", ["streetParts"]],
  ["tz", ["timezone"]],
];

/** The `show` sections each endpoint accepts, of those this adapter reads. */
const SHOWN = {
  geocode: ["countryInfo", "secondaryUnitInfo", "streetInfo", "tz"],
  revgeocode: ["countryInfo", "streetInfo", "tz"],
  autosuggest: ["details", "streetInfo", "tz"],
  autocomplete: ["streetInfo"],
  discover: ["streetInfo", "tz"],
  lookup: ["countryInfo", "streetInfo", "tz"],
} as const;

function show(
  include: readonly Include[],
  supported: readonly string[],
  forced: readonly string[] = [],
): string | undefined {
  const values = SHOW.filter(
    ([value, needs]) =>
      supported.includes(value) &&
      (needs === "always" ||
        forced.includes(value) ||
        needs.some((field) => include.includes(field))),
  ).map(([value]) => value);
  return values.length === 0 ? undefined : values.join(",");
}

type TypeMap = Partial<Record<PlaceType, readonly string[]>>;

/**
 * The HERE `types` values whose results hold each unified type.
 * Several are wider than the unified type, so the results are always filtered here as well.
 * A type with no entry cannot be narrowed by HERE, and then no `types` is sent.
 */
const TYPES: { geocode: TypeMap; revgeocode: TypeMap; autocomplete: TypeMap } = {
  geocode: {
    address: ["houseNumber"],
    street: ["street"],
    intersection: ["address"],
    poi: ["place"],
    postcode: ["postalCode"],
    locality: ["city"],
    neighbourhood: ["area"],
    district: ["area"],
    region: ["area"],
    country: ["area"],
    area: ["address", "area"],
  },
  revgeocode: {
    address: ["houseNumber"],
    street: ["street"],
    poi: ["place"],
    postcode: ["address", "area"],
    locality: ["city"],
    neighbourhood: ["area"],
    district: ["area"],
    region: ["area"],
    country: ["area"],
    area: ["address", "area"],
  },
  autocomplete: {
    address: ["houseNumber"],
    street: ["street"],
    intersection: ["address"],
    postcode: ["postalCode"],
    locality: ["city"],
    neighbourhood: ["area"],
    district: ["area"],
    region: ["area"],
    country: ["area"],
    area: ["area"],
  },
};

function nativeTypes(types: readonly PlaceType[] | undefined, map: TypeMap): string | undefined {
  if (types === undefined || types.length === 0) return undefined;
  const values = new Set<string>();
  for (const type of types) {
    const wide = map[type];
    if (wide === undefined) return undefined;
    for (const value of wide) values.add(value);
  }
  return [...values].join(",");
}

function ofTypes(results: PlaceRecord[], types: readonly PlaceType[] | undefined): PlaceRecord[] {
  return types === undefined ? results : results.filter((place) => types.includes(place.type));
}

// Batch JSONL is documented with `resultType` in upper case, so the type names are compared without case.
const lower = (value: string | undefined): string | undefined => value?.toLowerCase();

function typeOf(item: HereItem): PlaceType {
  switch (lower(item.resultType)) {
    case "housenumber":
      return "address";
    case "street":
      return "street";
    case "intersection":
      return "intersection";
    case "place":
      return "poi";
    case "postalcodepoint":
      return "postcode";
    case "addressblock":
      return "area";
    case "locality":
      switch (lower(item.localityType)) {
        case "city":
          return "locality";
        case "district":
        case "subdistrict":
          return "neighbourhood";
        case "postalcode":
          return "postcode";
        default:
          return "area";
      }
    case "administrativearea":
      switch (lower(item.administrativeAreaType)) {
        case "country":
          return "country";
        case "state":
          return "region";
        case "county":
          return "district";
        default:
          return "area";
      }
    default:
      return "unknown";
  }
}

function accuracyOf(item: HereItem): Accuracy | null {
  // Accuracy describes the position, and an `/autocomplete` item has none.
  if (item.position === undefined) return null;
  switch (lower(item.resultType)) {
    case "housenumber":
      // HERE flags a point address whose coordinates it estimated.
      if (item.estimatedPointAddress === true) return "approximate";
      switch (lower(item.houseNumberType)) {
        case "pa":
        case "mpa":
          return "rooftop";
        case "interpolated":
          return "interpolated";
        default:
          return null;
      }
    case "place":
      return "rooftop";
    case "street":
    case "intersection":
      return "street";
    case "postalcodepoint":
    case "addressblock":
    case "locality":
    case "administrativearea":
      return "centroid";
    default:
      return null;
  }
}

/** The short name. HERE's `title` is the whole label for an address or an area, so the part is read from the address. */
function nameOf(item: HereItem, type: PlaceType): string {
  const address = item.address ?? {};
  const part = ((): string | null => {
    switch (type) {
      case "address": {
        const number = text(address.houseNumber);
        const street = text(address.street);
        if (number === null || street === null) return null;
        // The order of number and street differs by country, so it is taken from HERE's own label.
        const label = address.label ?? item.title;
        return (
          [`${number} ${street}`, `${street} ${number}`].find((line) => label.startsWith(line)) ??
          null
        );
      }
      case "street":
        return text(address.street);
      case "postcode":
        return text(address.postalCode);
      case "locality":
        return text(address.city);
      case "neighbourhood":
        return lower(item.localityType) === "subdistrict"
          ? text(address.subdistrict)
          : text(address.district);
      case "district":
        return text(address.county);
      case "region":
        return text(address.state);
      case "country":
        return text(address.countryName);
      default:
        return null;
    }
  })();
  return part ?? item.title;
}

function status(score: number | undefined): MatchStatus | undefined {
  if (score === undefined) return undefined;
  return score >= 1 ? "matched" : score <= 0 ? "unmatched" : "partial";
}

function matchOf(scoring: NonNullable<HereItem["scoring"]>): Match {
  const field = scoring.fieldScore ?? {};
  const streets = field.streets ?? [];
  const parts: [keyof Match["components"], MatchStatus | undefined][] = [
    ["houseNumber", status(field.houseNumber)],
    // One score per street name in the query. They agree, or the street matched in part.
    [
      "street",
      streets.length === 0
        ? undefined
        : streets.every((score) => score >= 1)
          ? "matched"
          : streets.every((score) => score <= 0)
            ? "unmatched"
            : "partial",
    ],
    ["unit", status(field.unit)],
    ["locality", status(field.city)],
    ["district", status(field.county ?? field.countyCode)],
    ["region", status(field.state ?? field.stateCode)],
    ["postcode", status(field.postalCode)],
    ["country", status(field.country ?? field.countryCode)],
  ];
  const components: Match["components"] = {};
  for (const [part, matched] of parts) if (matched !== undefined) components[part] = matched;
  return { score: scoring.queryScore ?? null, label: null, components };
}

/** `+02:00` as minutes. HERE gives the offset at request time. */
function offsetMinutes(offset: string | undefined): number | null {
  const parts = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  if (parts === null) return null;
  return (parts[1] === "-" ? -1 : 1) * (Number(parts[2]) * 60 + Number(parts[3]));
}

function ranges(source: HereRange[] | undefined): TextRange[] | null {
  return source === undefined ? null : source.map(({ start, end }) => ({ start, end }));
}

function toPlace(item: HereItem): PlaceRecord {
  const stated = item.address ?? {};
  const type = typeOf(item);
  const address = emptyAddress();
  address.houseNumber = text(stated.houseNumber);
  address.street = text(stated.street);
  address.unit = text(stated.unit);
  address.neighbourhood = text(stated.district);
  address.locality = text(stated.city);
  address.district = text(stated.county);
  address.region = text(stated.state);
  address.regionCode = text(stated.stateCode);
  address.postcode = text(stated.postalCode);
  address.country = text(stated.countryName);
  // HERE's own `address.countryCode` is alpha-3. `countryInfo` carries the alpha-2 code where the endpoint has it.
  address.countryCode =
    text(item.countryInfo?.alpha2)?.toUpperCase() ?? alpha2(stated.countryCode ?? "") ?? null;
  const label = text(stated.label);
  const chain = item.chains?.find((candidate) => text(candidate.name) !== null);
  const contact = (kind: keyof HereContacts): string | null => {
    for (const block of item.contacts ?? []) {
      const value = text(block[kind]?.[0]?.value);
      if (value !== null) return value;
    }
    return null;
  };
  const hours = item.openingHours?.[0];
  const street = item.streetInfo?.[0];
  const zone = text(item.timeZone?.name);
  return {
    id: item.id,
    type,
    name: nameOf(item, type),
    label: label ?? item.title,
    location: item.position ? { lat: item.position.lat, lon: item.position.lng } : null,
    accuracy: accuracyOf(item),
    confidence: item.scoring?.queryScore ?? null,
    distance: item.distance ?? null,
    address,
    bbox: item.mapView
      ? [item.mapView.west, item.mapView.south, item.mapView.east, item.mapView.north]
      : null,
    addressDetails: {
      unitType: text(item.secondaryUnitInfo?.[0]?.normalizedUnitType),
      building: text(stated.building),
      floor: null,
      sublocality: null,
      postcodeSuffix: null,
    },
    streetParts: street
      ? {
          prefix: text(street.prefix),
          name: text(street.baseName),
          type: text(street.streetType),
          suffix: text(street.suffix),
        }
      : null,
    categories:
      item.categories?.map((category) => ({
        id: text(category.id),
        name: text(category.name),
        primary: category.primary === true,
      })) ?? null,
    brand: chain ? { name: chain.name as string, id: text(chain.id), wikidata: null } : null,
    contact: item.contacts
      ? { phone: contact("phone"), website: contact("www"), email: contact("email") }
      : null,
    openingHours: hours ? { text: hours.text ?? [], openNow: hours.isOpen ?? null } : null,
    // HERE says only that a place is closed for good, never that it is open.
    businessStatus: item.closedPermanently === "yes" ? "closed_permanently" : null,
    timezone:
      zone === null
        ? null
        : { name: zone, utcOffsetMinutes: offsetMinutes(item.timeZone?.utcOffset) },
    accessPoints:
      item.access?.map((point) => ({ lat: point.lat, lon: point.lng, kind: text(point.type) })) ??
      null,
    match: item.scoring ? matchOf(item.scoring) : null,
    // The ranges must index `label`, which is the address label when HERE sent one, else the title.
    highlights: ranges(label === null ? item.highlights?.title : item.highlights?.address?.label),
    raw: item,
  };
}

/** A structured address as HERE's qualified query. */
function qualified(address: StructuredAddress): string | undefined {
  const line = address.address !== undefined;
  const parts: [string, string | undefined][] = [
    ["houseNumber", line ? undefined : address.houseNumber],
    // HERE's `street` may hold the house number too, so a whole first line goes there.
    ["street", line ? streetLine(address) : address.street],
    ["city", address.locality],
    ["state", address.region],
    ["postalCode", address.postcode],
    ["country", address.country],
  ];
  const query = parts
    // A semicolon ends a sub-parameter, and HERE documents no way to escape one.
    .flatMap(([name, value]) => (value ? [`${name}=${value.replaceAll(";", " ")}`] : []))
    .join(";");
  return query === "" ? undefined : query;
}

function limitOf(request: BaseRequest, max: number): number | undefined {
  return request.limit === undefined ? undefined : Math.max(1, Math.min(request.limit, max));
}

function at(point: LatLon | undefined): string | undefined {
  return point === undefined ? undefined : `${point.lat},${point.lon}`;
}

/** `countries` as HERE's country filter, which takes ISO alpha-3 codes. */
function countryFilter(
  countries: readonly string[] | undefined,
  operation: string,
): string | undefined {
  if (countries === undefined || countries.length === 0) return undefined;
  const codes = countries.map((code) => {
    const long = alpha3(code);
    if (long === undefined)
      throw new GeocoderError(`${code} is not an ISO 3166-1 alpha-2 country code.`, {
        code: "invalid_request",
        provider: "here",
        operation,
      });
    return long;
  });
  return `countryCode:${codes.join(",")}`;
}

/**
 * Where `/autosuggest` and `/discover` search. They accept one of `at` and `in=bbox`, never both.
 * `within` is set when the country filter could not be sent, and is then applied to the results.
 */
function spatial(
  request: BaseRequest,
  operation: string,
): { at?: string; in?: string; within?: readonly string[] } {
  const countries = countryFilter(request.countries, operation);
  if (request.bounds !== undefined) {
    const box = { in: `bbox:${request.bounds.join(",")}` };
    // HERE allows a box with a country filter, but documents no way to write both in the one `in` a request may carry.
    return countries === undefined ? box : { ...box, within: request.countries ?? [] };
  }
  const centre = at(request.focus);
  if (centre === undefined) return {};
  return countries === undefined ? { at: centre } : { at: centre, in: countries };
}

/** Reads a message out of either API's error body. */
function describeError(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = body as HereErrorBody;
  if (typeof error.error_description === "string") return error.error_description;
  const parts = [error.title, error.cause, error.action].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  if (parts.length === 0) return undefined;
  return parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`)).join(" ");
}

/** One cell of a job's input. A newline always ends a record, even inside quotes. */
function cell(value: string): string {
  const flat = value.replace(/[\r\n]+/g, " ");
  return /[|"]/.test(flat) ? `"${flat.replaceAll('"', '""')}"` : flat;
}

const job = (id: string): string => `/batch/jobs/${encodeURIComponent(id)}`;
const json = async <T>(response: Promise<Response>): Promise<T> =>
  (await (await response).json()) as T;

const ENDED: ReadonlySet<string> = new Set(["completed", "failure", "stopped", "deleted"]);
const QUERY_ITEMS: ReadonlySet<string> = new Set(["categoryQuery", "chainQuery"]);

/** The HERE adapter. Its `native` reaches every HERE endpoint, and the Batch API job calls. */
export function here(options: HereOptions = {}): Adapter<HereNative> {
  const base = (service: HereService): string =>
    (
      options.baseUrls?.[service] ??
      `https://${service}.search.hereapi.com/${service === "batch" ? "v7" : "v1"}`
    ).replace(/\/+$/, "");
  const transport = createTransport(options, {
    name: "here",
    baseUrl: base("geocode"),
    describeError,
    // `X-Request-ID` only echoes what the caller sent. The correlation ID is HERE's own.
    requestIdHeaders: ["x-correlation-id", "x-request-id"],
  });

  const authorize = async (call: {
    query: URLSearchParams;
    headers: Record<string, string>;
  }): Promise<void> => {
    const { bearerToken, apiKey } = options;
    if (bearerToken !== undefined)
      call.headers["authorization"] =
        `Bearer ${typeof bearerToken === "string" ? bearerToken : await bearerToken()}`;
    else if (apiKey !== undefined) call.query.set("apiKey", apiKey);
  };

  /** Sends one request. The query is one value per key, since HERE rejects a repeated key. */
  async function send(call: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    service: HereService;
    path: string;
    query?: Record<string, unknown>;
    body?: string;
    headers?: Record<string, string>;
    idempotent?: boolean;
    options: RequestOptions | undefined;
  }): Promise<Response> {
    const query = toParams(call.query ?? {});
    const headers = { ...call.headers };
    await authorize({ query, headers });
    const method = call.method ?? "GET";
    return transport.send({
      method,
      path: `${base(call.service)}${call.path}`,
      query,
      headers,
      ...(call.body === undefined ? {} : { body: call.body }),
      idempotent: call.idempotent ?? method === "GET",
      options: call.options,
    });
  }

  async function search<T>(
    service: HereService,
    query: Record<string, unknown>,
    call: RequestOptions | undefined,
  ): Promise<{ data: T; response: Response }> {
    const response = await send({ service, path: `/${service}`, query, options: call });
    return { data: (await response.json()) as T, response };
  }

  function result(
    answer: { data: HereItems; response: Response },
    types: readonly PlaceType[] | undefined,
    within?: readonly string[],
  ): AdapterResult {
    const items = (answer.data.items ?? []).filter(
      (item) => item.resultType === undefined || !QUERY_ITEMS.has(item.resultType),
    );
    const places = ofTypes(items.map(toPlace), types);
    return {
      // A result whose country HERE did not name cannot be shown to lie in one asked for.
      results:
        within === undefined
          ? places
          : places.filter((place) => within.includes(place.address.countryCode ?? "")),
      raw: answer.data,
      response: answer.response,
      requestId: transport.requestId(answer.response.headers),
    };
  }

  const direct = nativeRequest(transport, authorize);
  // The files are served as `text/plain`, and 204 stands for an empty one.
  const file = async (path: string, call: RequestOptions | undefined): Promise<string> => {
    const response = await send({
      service: "batch",
      path,
      headers: { accept: "text/plain" },
      options: call,
    });
    return response.status === 204 ? "" : await response.text();
  };

  const native: HereNative = {
    request<T>(call: HereCall): APIPromise<T> {
      const { service, ...rest } = call;
      if (/^https?:\/\//.test(call.path)) return direct<T>(rest);
      if (service === undefined)
        return new APIPromise<T>(
          Promise.reject(
            new GeocoderError(
              `HERE has one host per service, so ${call.path} needs a \`service\`.`,
              {
                code: "invalid_request",
                provider: "here",
              },
            ),
          ),
          async () => undefined as T,
        );
      return direct<T>({ ...rest, path: `${base(service)}${call.path}` });
    },
    batch: {
      create(input, params, call) {
        const { service, ...query } = params;
        return json(
          send({
            method: "POST",
            service: "batch",
            path: "/batch/jobs",
            query: { serviceHrn: `hrn:here:service::olp-here:search-${service}-7`, ...query },
            body: input,
            headers: { "content-type": "text/plain; charset=UTF-8" },
            options: call,
          }),
        );
      },
      start: (id, call) =>
        // Starting a job that already runs does nothing, so a retry is safe.
        json(
          send({
            method: "PUT",
            service: "batch",
            path: `${job(id)}/start`,
            idempotent: true,
            options: call,
          }),
        ),
      status: (id, call) => json(send({ service: "batch", path: job(id), options: call })),
      results: (id, call) => file(`${job(id)}/results`, call),
      errors: (id, call) => file(`${job(id)}/errors`, call),
      stop: (id, call) =>
        json(
          send({
            method: "PUT",
            service: "batch",
            path: `${job(id)}/stop`,
            idempotent: true,
            options: call,
          }),
        ),
      delete: (id, call) =>
        json(
          send({
            method: "DELETE",
            service: "batch",
            path: job(id),
            idempotent: true,
            options: call,
          }),
        ),
    },
  };

  /**
   * Runs records through a Batch API job and reads its JSONL results.
   * `rows` are the cells after `recId`, and `defaults` are sent once in the header for every record.
   */
  async function run(
    kind: "geocode" | "reverse",
    columns: readonly string[],
    rows: readonly (readonly string[])[],
    defaults: Record<string, string | number | undefined>,
    context: BatchContext,
  ): Promise<AdapterBatchItem[]> {
    const call = context.options;
    const operation = `batch.${kind}`;
    const total = rows.length;
    // HERE rejects an empty input, and there is nothing to ask.
    if (total === 0) return [];
    const header = [
      "recId",
      ...columns,
      ...Object.entries(defaults).flatMap(([name, value]) =>
        value === undefined ? [] : [`${name}=${value}`],
      ),
    ].join("|");
    // The record ID is the item's index, which is how a result finds its item again.
    const lines = [
      header,
      ...rows.map((cells, index) => [String(index), ...cells.map(cell)].join("|")),
    ];
    const created = await native.batch.create(
      lines.join("\n"),
      {
        service: kind === "geocode" ? "geocode" : "revgeocode",
        inputDelimiter: "|",
        // JSONL carries the whole result item. CSV would flatten it to a few columns.
        outputType: "jsonl",
        // Started in a call of its own, so a refused start is told apart from a refused upload.
        startJob: false,
      },
      call,
    );
    const items = new Map<number, AdapterBatchItem>();
    try {
      await native.batch.start(created.id, call);
      let state: HereJobStatus;
      let reported = 0;
      for (;;) {
        state = await native.batch.status(created.id, call);
        // An invalid record is never processed, and it is finished all the same.
        const done = Math.min(
          total,
          (state.records?.processed ?? 0) + (state.records?.invalid ?? 0),
        );
        if (done > reported) context.onProgress((reported = done), total);
        if (ENDED.has(state.status)) break;
        await sleep(context.pollInterval, call?.signal);
      }
      if (state.status === "stopped" || state.status === "deleted")
        throw new GeocoderError(`HERE batch job ${created.id} was ${state.status}.`, {
          code: "conflict",
          provider: "here",
          operation,
          body: state,
        });
      // A failed job has no results to fetch, only its error report.
      if (state.status === "completed" && state.resultsHref !== "") {
        for (const line of (await native.batch.results(created.id, call)).split(/\r?\n/)) {
          if (line.trim() === "") continue;
          const row = JSON.parse(line) as JobLine;
          const index = Number(row.recId);
          if (!Number.isInteger(index)) continue;
          items.set(index, {
            index,
            results: ofTypes((row.results ?? []).map(toPlace), context.request.types),
          });
        }
      }
      if (state.errorsHref !== "") {
        for (const line of (await native.batch.errors(created.id, call)).split(/\r?\n/)) {
          // The message is JSON that is not quoted, so only the first two delimiters split the line.
          const first = line.indexOf("|");
          const second = line.indexOf("|", first + 1);
          if (first < 0 || second < 0 || line.startsWith("recId|")) continue;
          const message = line.slice(second + 1);
          let body: unknown = message;
          try {
            body = JSON.parse(message);
          } catch {
            // Kept as the text HERE sent.
          }
          const recId = line.slice(0, first);
          const record = (body as HereErrorBody | null)?.jobRecord;
          // A line HERE could not parse has no record ID, but the report quotes the line itself.
          const index = /^\d+$/.test(recId)
            ? Number(recId)
            : typeof record === "string"
              ? lines.indexOf(record) - 1
              : -1;
          if (index < 0 || index >= total) continue;
          const code = Number(line.slice(first + 1, second));
          const hints = { provider: "here", message: describeError(body) };
          items.set(index, {
            index,
            results: [],
            // 999 is the Batch API's own code for a record it refused. It is no HTTP status.
            error:
              code === 999
                ? new BadRequestError(hints.message ?? "HERE refused the record.", {
                    status: code,
                    body,
                    provider: "here",
                  })
                : OgError.fromResponse(code, body, new Headers(), hints),
          });
        }
      }
      if (state.status === "failure" && items.size === 0)
        throw new GeocoderError(`HERE batch job ${created.id} failed.`, {
          code: "provider_error",
          provider: "here",
          operation,
          body: state,
        });
      for (let index = 0; index < total; index++) {
        if (items.has(index)) continue;
        items.set(index, {
          index,
          results: [],
          error: new GeocoderError(
            state.status === "failure"
              ? `HERE batch job ${created.id} failed.`
              : `HERE batch job ${created.id} answered nothing for this record.`,
            { code: "provider_error", provider: "here", operation, body: state },
          ),
        });
      }
      if (reported < total) context.onProgress(total, total);
    } finally {
      // The results are read, so the job need not wait out its retention at HERE.
      await native.batch.delete(created.id, { maxRetries: 0 }).catch(() => {});
    }
    return Array.from({ length: total }, (_, index) => items.get(index) as AdapterBatchItem);
  }

  return {
    id: "here",
    native,
    capabilities: CAPABILITIES,
    async geocode(request, call) {
      const answer = await search<HereItems>(
        "geocode",
        {
          ...(request.address === undefined
            ? { q: request.query }
            : { qq: qualified(request.address) }),
          at: at(request.focus),
          in: countryFilter(request.countries, "geocode"),
          types: nativeTypes(request.types, TYPES.geocode),
          lang: request.language?.[0],
          limit: limitOf(request, 100),
          show: show(request.include, SHOWN.geocode),
        },
        call,
      );
      return result(answer, request.types);
    },
    async reverse(request, call) {
      const answer = await search<HereItems>(
        "revgeocode",
        {
          at: `${request.point.lat},${request.point.lon}`,
          types: nativeTypes(request.types, TYPES.revgeocode),
          lang: request.language?.[0],
          limit: limitOf(request, 100),
          show: show(request.include, SHOWN.revgeocode),
        },
        call,
      );
      return result(answer, request.types);
    },
    async autocomplete(request, call) {
      const { within, ...where } = spatial(request, "autocomplete");
      // `/autosuggest` needs a spatial reference and answers places with positions.
      // Without one only `/autocomplete` can be asked, and it knows addresses alone.
      const answer =
        where.at === undefined && where.in === undefined
          ? await search<HereItems>(
              "autocomplete",
              {
                q: request.query,
                in: countryFilter(request.countries, "autocomplete"),
                types: nativeTypes(request.types, TYPES.autocomplete),
                lang: request.language?.[0],
                limit: limitOf(request, 20),
                show: show(request.include, SHOWN.autocomplete),
              },
              call,
            )
          : await search<HereItems>(
              "autosuggest",
              {
                q: request.query,
                ...where,
                lang: request.language?.[0],
                limit: limitOf(request, 100),
                // Without `details` a suggestion carries only its label, and no country to filter by.
                show: show(request.include, SHOWN.autosuggest, within ? ["details"] : []),
              },
              call,
            );
      return result(answer, request.types, within);
    },
    async places(request, call) {
      const { within, ...where } = spatial(request, "places");
      if (where.at === undefined && where.in === undefined)
        throw new GeocoderError(
          "HERE discover needs `focus` or `bounds`. `countries` narrows a search but cannot place it.",
          { code: "invalid_request", provider: "here", operation: "places" },
        );
      const answer = await search<HereItems>(
        "discover",
        {
          q: request.query,
          ...where,
          lang: request.language?.[0],
          limit: limitOf(request, 100),
          show: show(request.include, SHOWN.discover),
        },
        call,
      );
      return result(answer, request.types, within);
    },
    async lookup(request, call) {
      type Answer = { data: HereItem; response: Response } | { error: unknown } | undefined;
      const answers = await pool<string, Answer>(
        request.ids,
        4,
        (id) =>
          search<HereItem>(
            "lookup",
            { id, lang: request.language?.[0], show: show(request.include, SHOWN.lookup) },
            call,
          ),
        // HERE answers 404 for an ID it does not know, which is no failure of the lookup.
        (error) => (error instanceof NotFoundError ? undefined : { error }),
      );
      const found: { data: HereItem; response: Response }[] = [];
      for (const answer of answers) {
        if (answer === undefined) continue;
        if ("error" in answer) throw answer.error;
        found.push(answer);
      }
      const response = found.at(-1)?.response;
      return {
        results: found.map((answer) => toPlace(answer.data)),
        // One body per ID found, since HERE looks up one ID per request.
        raw: found.map((answer) => answer.data),
        response,
        requestId: response === undefined ? undefined : transport.requestId(response.headers),
      };
    },
    batch: {
      // Async, so a country code HERE cannot take rejects the batch like any other failure.
      async geocode(items, context) {
        const { request } = context;
        return run(
          "geocode",
          ["q", "qq"],
          items.map((item) =>
            item.address === undefined
              ? [item.query ?? "", ""]
              : ["", qualified(item.address) ?? ""],
          ),
          {
            at: at(request.focus),
            in: countryFilter(request.countries, "batch.geocode"),
            types: nativeTypes(request.types, TYPES.geocode),
            lang: request.language?.[0],
            // Left out, the Batch API answers one result per record.
            limit: limitOf(request, 100),
            show: show(request.include, SHOWN.geocode),
          },
          context,
        );
      },
      reverse(items, context) {
        const { request } = context;
        return run(
          "reverse",
          ["at"],
          items.map((item) => [`${item.lat},${item.lon}`]),
          {
            types: nativeTypes(request.types, TYPES.revgeocode),
            lang: request.language?.[0],
            limit: limitOf(request, 100),
            show: show(request.include, SHOWN.revgeocode),
          },
          context,
        );
      },
    },
    errorCode(error) {
      // A record the Batch API refused is reported with its own code 999.
      if (error.status === 999) return "invalid_request";
      const body = error.body as HereErrorBody | null | undefined;
      // HERE answers 400 for an input over the size limit.
      if (typeof body === "object" && body?.code === "E6004003") return "payload_too_large";
      return undefined;
    },
  };
}
