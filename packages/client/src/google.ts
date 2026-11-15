/**
 * The adapter for Google Maps Platform, over Places API (New) v1 and Geocoding API v4.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { google } from "@open-geocode/client/google";
 * const geo = new Geocoder({ adapter: google({ apiKey: "..." }) });
 * ```
 *
 * `geocode` and `reverse` run on Geocoding, and `autocomplete`, `places` and `lookup` on Places.
 * A suggestion carries no coordinates, so resolve it with `lookup` and the same `session`.
 */
import {
  type Adapter,
  type AdapterOptions,
  type AdapterResult,
  createTransport,
  emptyAddress,
  type NativeRequest,
  nativeRequest,
  pool,
  streetLine,
  text,
} from "./adapter.ts";
import type { RequestOptions } from "./core.ts";
import { type GeocoderErrorCode, NotFoundError } from "./errors.ts";
import type {
  AccessPoint,
  Accuracy,
  Address,
  BBox,
  BusinessStatus,
  FieldName,
  Include,
  LatLon,
  OptionName,
  PlaceRecord,
  PlaceType,
  StructuredAddress,
  TextRange,
} from "./types.ts";

/** Options for {@link google}. */
export interface GoogleOptions extends AdapterOptions {
  /** A Google Maps Platform API key, sent in the `X-Goog-Api-Key` header. */
  apiKey: string;
  /** Where Places API (New) is reached. Default `https://places.googleapis.com`. */
  placesBaseUrl?: string | undefined;
  /** Where Geocoding API v4 is reached. Default `https://geocode.googleapis.com`. */
  geocodingBaseUrl?: string | undefined;
}

/** Google's own APIs, with the adapter's key and the shared retries and timeouts. */
export interface GoogleNative {
  /** Any Places API (New) call, such as `{ path: "/v1/places:searchNearby", body }`. */
  places: NativeRequest;
  /** Any Geocoding API call, such as `{ path: "/v4/geocode/destinations", body }`. */
  geocoding: NativeRequest;
}

// Proto3 JSON leaves out a number that is zero, so every numeric key may be absent.
interface LatLng {
  latitude?: number;
  longitude?: number;
}

interface Viewport {
  low?: LatLng;
  high?: LatLng;
}

interface LocalizedText {
  text?: string;
}

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

interface Hours {
  weekdayDescriptions?: string[];
  openNow?: boolean;
}

/** A Geocoding result or a Places place. The two share most of their fields. */
interface Result {
  /** The place ID on a place. */
  id?: string;
  /** The place ID on a Geocoding result. */
  placeId?: string;
  displayName?: LocalizedText;
  formattedAddress?: string;
  location?: LatLng;
  granularity?: string;
  viewport?: Viewport;
  bounds?: Viewport;
  types?: string[];
  addressComponents?: AddressComponent[];
  postalAddress?: { regionCode?: string; addressLines?: string[] };
  plusCode?: { globalCode?: string; compoundCode?: string };
  primaryType?: string;
  primaryTypeDisplayName?: LocalizedText;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: Hours;
  currentOpeningHours?: Hours;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  timeZone?: { id?: string };
  utcOffsetMinutes?: number;
  entrances?: { location?: LatLng; tags?: string[] }[];
  navigationPoints?: { location?: LatLng; usages?: string[] }[];
}

interface FormattableText {
  text?: string;
  matches?: { startOffset?: number; endOffset?: number }[];
}

interface Prediction {
  placeId?: string;
  text?: FormattableText;
  structuredFormat?: { mainText?: FormattableText };
  types?: string[];
  distanceMeters?: number;
}

interface Suggestions {
  suggestions?: { placePrediction?: Prediction }[];
}

interface ErrorBody {
  error?: { message?: string; status?: string; details?: { reason?: string }[] };
}

const TYPES: ReadonlyMap<string, PlaceType> = new Map<string, PlaceType>([
  ["establishment", "poi"],
  ["point_of_interest", "poi"],
  ["street_address", "address"],
  ["premise", "address"],
  ["subpremise", "address"],
  ["intersection", "intersection"],
  ["route", "street"],
  ["postal_code", "postcode"],
  ["postal_code_prefix", "postcode"],
  ["neighborhood", "neighbourhood"],
  ["locality", "locality"],
  ["postal_town", "locality"],
  ["administrative_area_level_2", "district"],
  ["administrative_area_level_1", "region"],
  ["country", "country"],
  ["sublocality", "area"],
  ["sublocality_level_1", "area"],
  ["sublocality_level_2", "area"],
  ["sublocality_level_3", "area"],
  ["sublocality_level_4", "area"],
  ["sublocality_level_5", "area"],
  ["administrative_area_level_3", "area"],
  ["administrative_area_level_4", "area"],
  ["administrative_area_level_5", "area"],
  ["administrative_area_level_6", "area"],
  ["administrative_area_level_7", "area"],
  ["colloquial_area", "area"],
  ["natural_feature", "area"],
  ["archipelago", "area"],
  ["continent", "area"],
]);

/** Which reading wins when a record carries several types. A business at an address is a POI. */
const RANK: readonly PlaceType[] = [
  "poi",
  "address",
  "intersection",
  "street",
  "postcode",
  "neighbourhood",
  "locality",
  "district",
  "region",
  "country",
  "area",
];

const ACCURACY: ReadonlyMap<string, Accuracy> = new Map<string, Accuracy>([
  ["ROOFTOP", "rooftop"],
  ["RANGE_INTERPOLATED", "interpolated"],
  ["GEOMETRIC_CENTER", "centroid"],
  ["APPROXIMATE", "approximate"],
]);

// FUTURE_OPENING has no unified equivalent, so it reads as no value.
const BUSINESS: ReadonlyMap<string, BusinessStatus> = new Map<string, BusinessStatus>([
  ["OPERATIONAL", "operational"],
  ["CLOSED_TEMPORARILY", "closed_temporarily"],
  ["CLOSED_PERMANENTLY", "closed_permanently"],
]);

/** The unified code of each `error.status`. Several share an HTTP status, so the status alone misreads them. */
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
  ["INTERNAL", "provider_error"],
  ["UNKNOWN", "provider_error"],
  ["DATA_LOSS", "provider_error"],
]);

/**
 * The field mask is built from these lists, since Places bills by the fields asked for.
 * The default paths fill the nine default fields. `addressDetails` reads `addressComponents`,
 * which is a default path, so it adds none. `raw` asks for `*`.
 *
 * Places paths each unified `include` adds, on `places:searchText` and `places/{id}`.
 * - `bbox`: `viewport`
 * - `addressLines`: `postalAddress`
 * - `categories`: `primaryType`, `primaryTypeDisplayName`
 * - `contact`: `internationalPhoneNumber`, `websiteUri`
 * - `openingHours`: `regularOpeningHours.weekdayDescriptions`, `regularOpeningHours.openNow`, `currentOpeningHours.openNow`
 * - `rating`: `rating`, `userRatingCount`
 * - `businessStatus`: `businessStatus`
 * - `timezone`: `timeZone`, `utcOffsetMinutes`
 * - `accessPoints`: `entrances`, `navigationPoints`
 * - `plusCode`: `plusCode`
 */
const PLACE_PATHS: readonly string[] = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "addressComponents",
];
const PLACE_INCLUDES: Partial<Record<Include, readonly string[]>> = {
  bbox: ["viewport"],
  addressLines: ["postalAddress"],
  categories: ["primaryType", "primaryTypeDisplayName"],
  contact: ["internationalPhoneNumber", "websiteUri"],
  openingHours: [
    "regularOpeningHours.weekdayDescriptions",
    "regularOpeningHours.openNow",
    "currentOpeningHours.openNow",
  ],
  rating: ["rating", "userRatingCount"],
  businessStatus: ["businessStatus"],
  timezone: ["timeZone", "utcOffsetMinutes"],
  accessPoints: ["entrances", "navigationPoints"],
  plusCode: ["plusCode"],
};

/**
 * Geocoding paths each unified `include` adds, on `geocode/address` and `geocode/location`.
 * - `bbox`: `viewport`, `bounds`
 * - `addressLines`: `postalAddress`
 * - `plusCode`: `plusCode`
 */
const GEOCODE_PATHS: readonly string[] = [
  "placeId",
  "location",
  "granularity",
  "formattedAddress",
  "addressComponents",
  "types",
];
const GEOCODE_INCLUDES: Partial<Record<Include, readonly string[]>> = {
  bbox: ["viewport", "bounds"],
  addressLines: ["postalAddress"],
  plusCode: ["plusCode"],
};

/**
 * Autocomplete paths, under `suggestions.placePrediction`.
 * `highlights` adds `text.matches`, and `focus` adds `distanceMeters`.
 */
const SUGGESTION_PATHS: readonly string[] = [
  "placeId",
  "text.text",
  "structuredFormat.mainText.text",
  "types",
];

function fieldMask(
  include: readonly Include[],
  paths: readonly string[],
  extras: Partial<Record<Include, readonly string[]>>,
  prefix: string,
): string {
  if (include.includes("raw")) return "*";
  return [...paths, ...include.flatMap((name) => extras[name] ?? [])]
    .map((path) => `${prefix}${path}`)
    .join(",");
}

/** The widest circle the API takes, so `focus` steers the ranking without acting as a filter. */
const FOCUS_RADIUS_M = 50_000;
/** The most `places:searchText` returns on one page. */
const PAGE_SIZE = 20;
/** The most types `includedPrimaryTypes` takes. */
const PRIMARY_TYPES = 5;
/** Place Details requests in flight at once. */
const LOOKUPS = 4;

const GEOCODE_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "address",
  "bbox",
  "addressDetails",
  "addressLines",
  "plusCode",
];
const PLACE_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "address",
  "bbox",
  "addressDetails",
  "addressLines",
  "categories",
  "contact",
  "openingHours",
  "rating",
  "businessStatus",
  "timezone",
  "accessPoints",
  "plusCode",
];

function point(source: LatLng | undefined): LatLon | null {
  return source === undefined ? null : { lat: source.latitude ?? 0, lon: source.longitude ?? 0 };
}

function box(source: Viewport | undefined): BBox | null {
  const low = point(source?.low);
  const high = point(source?.high);
  return low === null || high === null ? null : [low.lon, low.lat, high.lon, high.lat];
}

function rectangle([west, south, east, north]: BBox): { rectangle: Viewport } {
  return {
    rectangle: {
      low: { latitude: south, longitude: west },
      high: { latitude: north, longitude: east },
    },
  };
}

function toType(types: readonly string[] | undefined): PlaceType {
  const found = new Set<PlaceType>();
  for (const type of types ?? []) {
    const mapped = TYPES.get(type);
    if (mapped !== undefined) found.add(mapped);
  }
  return RANK.find((type) => found.has(type)) ?? "unknown";
}

/**
 * The Google primary types that read as exactly these unified types, for `includedPrimaryTypes`.
 * Nothing when a type has no such list, or when the list is longer than the API takes.
 * The caller still filters the answer, so this only saves suggestions from being crowded out.
 */
function primaryTypes(types: readonly PlaceType[]): string[] | undefined {
  // A POI's primary type is its category, such as `restaurant`, which no short list covers.
  if (types.length === 0 || types.includes("poi")) return undefined;
  const wanted = new Set(types);
  const names = [...TYPES].filter(([, type]) => wanted.has(type)).map(([name]) => name);
  const covered = new Set(names.map((name) => TYPES.get(name)));
  return covered.size === wanted.size && names.length <= PRIMARY_TYPES ? names : undefined;
}

function toAddress(source: Result): Address {
  const parts = source.addressComponents ?? [];
  const part = (type: string): AddressComponent | undefined =>
    parts.find((component) => component.types?.includes(type));
  const long = (type: string): string | null => text(part(type)?.longText);
  const region = part("administrative_area_level_1");
  const country = part("country");
  const address = emptyAddress();
  address.houseNumber = long("street_number");
  address.street = long("route");
  address.unit = long("subpremise");
  address.neighbourhood = long("neighborhood");
  address.locality = long("locality") ?? long("postal_town");
  address.district = long("administrative_area_level_2");
  address.region = text(region?.longText);
  // Google repeats the name as the short text where a region has no code, so only a differing one is a code.
  address.regionCode = region?.shortText === region?.longText ? null : text(region?.shortText);
  address.postcode = long("postal_code");
  address.country = text(country?.longText);
  // Both sources hold the two-letter country code, so upper-casing it is its ISO form.
  const code = [country?.shortText, source.postalAddress?.regionCode].find(
    (value) => value !== undefined && /^[A-Za-z]{2}$/.test(value),
  );
  address.countryCode = code?.toUpperCase() ?? null;
  return address;
}

/**
 * House number and street as Google writes them.
 * Google sends no such line of its own, so the one inside `formattedAddress` is used,
 * which keeps the country's own order of number and street.
 */
function streetName(source: Result, address: Address): string | undefined {
  const route = source.addressComponents?.find((component) => component.types?.includes("route"));
  const label = source.formattedAddress ?? "";
  if (address.houseNumber !== null)
    for (const street of [route?.shortText, route?.longText])
      for (const line of [`${address.houseNumber} ${street}`, `${street} ${address.houseNumber}`])
        if (street && label.includes(line)) return line;
  return streetLine({
    houseNumber: address.houseNumber ?? undefined,
    street: address.street ?? undefined,
  });
}

function nameOf(source: Result, type: PlaceType, address: Address): string {
  const display = text(source.displayName?.text);
  if (display !== null) return display;
  const street = type === "address" ? streetName(source, address) : undefined;
  if (street !== undefined) return street;
  // A Geocoding result has no name of its own. The component of its own type holds it.
  const own = source.addressComponents?.find((component) =>
    component.types?.some((kind) => kind !== "political" && source.types?.includes(kind)),
  );
  return text(own?.longText) ?? source.formattedAddress ?? "";
}

/** The fields a Geocoding result and a place share. */
function toPlace(source: Result): PlaceRecord {
  const type = toType(source.types);
  const address = toAddress(source);
  const name = nameOf(source, type, address);
  const formatted = text(source.formattedAddress);
  const location = point(source.location);
  const long = (kind: string): string | null =>
    text(source.addressComponents?.find((part) => part.types?.includes(kind))?.longText);
  const lines = source.postalAddress?.addressLines;
  const plus = source.plusCode;
  return {
    id: text(source.id) ?? text(source.placeId),
    type,
    name,
    // A POI's formatted address leaves its name out, so the label leads with it.
    label:
      formatted === null
        ? name
        : type === "poi" && !formatted.includes(name)
          ? `${name}, ${formatted}`
          : formatted,
    location,
    accuracy: ACCURACY.get(source.granularity ?? "") ?? null,
    confidence: null,
    // Google sends no distance for these, so the Geocoder measures it.
    distance: null,
    address,
    // The viewport is the box Google frames the result with. `bounds` is the feature's own extent.
    bbox: box(source.viewport) ?? box(source.bounds),
    addressDetails:
      source.addressComponents === undefined
        ? null
        : {
            unitType: null,
            building: long("premise"),
            floor: long("floor"),
            sublocality: long("sublocality_level_1") ?? long("sublocality"),
            postcodeSuffix: long("postal_code_suffix"),
          },
    addressLines: lines?.length ? [...lines] : null,
    plusCode:
      plus === undefined
        ? null
        : { global: text(plus.globalCode), compound: text(plus.compoundCode) },
    raw: source,
  };
}

function accessPoints(source: Result): AccessPoint[] | null {
  const points: AccessPoint[] = [];
  const add = (location: LatLng | undefined, kind: string | undefined): void => {
    const at = point(location);
    if (at !== null) points.push({ ...at, kind: kind ?? null });
  };
  // `kind` is Google's own tag or usage, such as `PREFERRED` or `DROPOFF`.
  for (const entrance of source.entrances ?? []) add(entrance.location, entrance.tags?.[0]);
  for (const stop of source.navigationPoints ?? []) add(stop.location, stop.usages?.[0]);
  return points.length === 0 ? null : points;
}

/** A place with the fields only Places has. */
function toDetailedPlace(source: Result): PlaceRecord {
  const place = toPlace(source);
  const phone = text(source.internationalPhoneNumber);
  const website = text(source.websiteUri);
  const hours = source.regularOpeningHours?.weekdayDescriptions ?? [];
  const openNow =
    source.currentOpeningHours?.openNow ?? source.regularOpeningHours?.openNow ?? null;
  const zone = text(source.timeZone?.id);
  place.categories = source.types?.length
    ? source.types.map((id) => ({
        id,
        name: id === source.primaryType ? text(source.primaryTypeDisplayName?.text) : null,
        primary: id === source.primaryType,
      }))
    : null;
  place.contact = phone === null && website === null ? null : { phone, website, email: null };
  place.openingHours =
    hours.length === 0 && openNow === null ? null : { text: [...hours], openNow };
  place.rating =
    source.rating === undefined
      ? null
      : { value: source.rating, count: source.userRatingCount ?? null };
  place.businessStatus = BUSINESS.get(source.businessStatus ?? "") ?? null;
  place.timezone =
    zone === null ? null : { name: zone, utcOffsetMinutes: source.utcOffsetMinutes ?? null };
  place.accessPoints = accessPoints(source);
  return place;
}

function toSuggestion(source: Prediction): PlaceRecord {
  const label = source.text?.text ?? "";
  const highlights: TextRange[] | undefined = source.text?.matches?.map((match) => ({
    start: match.startOffset ?? 0,
    end: match.endOffset ?? 0,
  }));
  return {
    id: text(source.placeId),
    type: toType(source.types),
    name: text(source.structuredFormat?.mainText?.text) ?? label,
    label,
    location: null,
    accuracy: null,
    confidence: null,
    // Google leaves the distance out when it is zero, and on routes, so an absent one is unknown.
    distance: source.distanceMeters ?? null,
    address: emptyAddress(),
    highlights: highlights?.length ? highlights : null,
    raw: source,
  };
}

/** The structured form of `geocode/address`, as dotted `address.*` parameters. */
function addressParams(address: StructuredAddress): URLSearchParams {
  const params = new URLSearchParams();
  const set = (name: string, value: string | undefined): void => {
    if (value) params.append(`address.${name}`, value);
  };
  const code = address.country !== undefined && /^[A-Za-z]{2}$/.test(address.country);
  set("addressLines", streetLine(address));
  // A postal address has no part for a country's name, so a name goes in as the last line.
  if (!code) set("addressLines", address.country);
  set("locality", address.locality);
  set("administrativeArea", address.region);
  set("postalCode", address.postcode);
  if (code) set("regionCode", address.country?.toUpperCase());
  return params;
}

function ofTypes(results: PlaceRecord[], types: readonly PlaceType[] | undefined): PlaceRecord[] {
  // Google's own type filters use its own vocabulary, so the adapter applies the unified types itself.
  return types === undefined ? results : results.filter((place) => types.includes(place.type));
}

/** The caller's options with the field mask, which a caller's own header may still replace. */
function masked(mask: string, call: RequestOptions | undefined): RequestOptions {
  return { ...call, headers: { "X-Goog-FieldMask": mask, ...call?.headers } };
}

/** The Google adapter. Its `native` reaches Places and Geocoding directly. */
export function google(options: GoogleOptions): Adapter<GoogleNative> {
  const transport = createTransport(options, {
    name: "google",
    baseUrl: options.placesBaseUrl ?? "https://places.googleapis.com",
    describeError: (body) =>
      text((body as ErrorBody | null | undefined)?.error?.message) ?? undefined,
  });
  const authorize = (call: { headers: Record<string, string> }): void => {
    call.headers["X-Goog-Api-Key"] = options.apiKey;
  };
  const places = nativeRequest(transport, authorize);
  const geocoding = nativeRequest(
    transport,
    authorize,
    (options.geocodingBaseUrl ?? "https://geocode.googleapis.com").replace(/\/+$/, ""),
  );

  async function geocoded(
    path: string,
    query: URLSearchParams,
    request: { language?: string[]; include: Include[]; types?: PlaceType[] },
    call: RequestOptions | undefined,
  ): Promise<AdapterResult> {
    const language = request.language?.[0];
    if (language !== undefined) query.set("languageCode", language);
    const answer = await geocoding<{ results?: Result[] }>({
      ...masked(fieldMask(request.include, GEOCODE_PATHS, GEOCODE_INCLUDES, "results."), call),
      path,
      query,
    }).withResponse();
    return {
      results: ofTypes((answer.data.results ?? []).map(toPlace), request.types),
      raw: answer.data,
      response: answer.response,
      requestId: answer.requestId,
    };
  }

  const geocodeOptions: readonly OptionName[] = ["limit", "language", "types"];

  return {
    id: "google",
    native: { places, geocoding },
    capabilities: {
      geocode: { options: [...geocodeOptions, "structured"], fields: GEOCODE_FIELDS },
      reverse: { options: geocodeOptions, fields: GEOCODE_FIELDS },
      autocomplete: {
        options: ["limit", "language", "countries", "focus", "bounds", "types", "session"],
        fields: ["id", "distance", "highlights"],
        coordinates: false,
      },
      places: {
        options: ["limit", "language", "focus", "bounds", "types"],
        fields: PLACE_FIELDS,
      },
      lookup: { options: ["language", "session"], fields: PLACE_FIELDS },
    },
    geocode(request, call) {
      return request.address === undefined
        ? geocoded(
            `/v4/geocode/address/${encodeURIComponent(request.query ?? "")}`,
            new URLSearchParams(),
            request,
            call,
          )
        : geocoded("/v4/geocode/address", addressParams(request.address), request, call);
    },
    reverse(request, call) {
      const { lat, lon } = request.point;
      return geocoded(`/v4/geocode/location/${lat},${lon}`, new URLSearchParams(), request, call);
    },
    async autocomplete(request, call) {
      const { focus, bounds, include } = request;
      const paths = [
        ...SUGGESTION_PATHS,
        ...(include.includes("highlights") ? ["text.matches"] : []),
        ...(focus === undefined ? [] : ["distanceMeters"]),
      ];
      const primary = request.types === undefined ? undefined : primaryTypes(request.types);
      const origin =
        focus === undefined ? undefined : { latitude: focus.lat, longitude: focus.lon };
      const answer = await places<Suggestions>({
        ...masked(fieldMask(include, paths, {}, "suggestions.placePrediction."), call),
        path: "/v1/places:autocomplete",
        body: {
          input: request.query,
          ...(request.language?.[0] === undefined ? {} : { languageCode: request.language[0] }),
          ...(request.countries?.length
            ? { includedRegionCodes: request.countries.map((code) => code.toLowerCase()) }
            : {}),
          ...(primary === undefined ? {} : { includedPrimaryTypes: primary }),
          // `origin` is what makes Google measure `distanceMeters`.
          ...(origin === undefined ? {} : { origin }),
          // The API takes a bias or a restriction, never both, and the restriction is the promise to keep.
          ...(bounds !== undefined
            ? { locationRestriction: rectangle(bounds) }
            : origin !== undefined
              ? { locationBias: { circle: { center: origin, radius: FOCUS_RADIUS_M } } }
              : {}),
          ...(request.session === undefined ? {} : { sessionToken: request.session }),
        },
        // A search changes nothing, so a retry may repeat it.
        idempotent: true,
      }).withResponse();
      const predictions = (answer.data.suggestions ?? []).flatMap((suggestion) =>
        suggestion.placePrediction === undefined ? [] : [suggestion.placePrediction],
      );
      return {
        results: ofTypes(predictions.map(toSuggestion), request.types),
        raw: answer.data,
        response: answer.response,
        requestId: answer.requestId,
      };
    },
    async places(request, call) {
      const { focus, bounds, limit } = request;
      const answer = await places<{ places?: Result[] }>({
        ...masked(fieldMask(request.include, PLACE_PATHS, PLACE_INCLUDES, "places."), call),
        path: "/v1/places:searchText",
        body: {
          textQuery: request.query,
          ...(request.language?.[0] === undefined ? {} : { languageCode: request.language[0] }),
          // The type filter runs after the search, so it needs the whole page to pick from.
          ...(limit === undefined || limit < 1 || request.types !== undefined
            ? {}
            : { pageSize: Math.min(limit, PAGE_SIZE) }),
          // The API takes a bias or a restriction, never both, and the restriction is the promise to keep.
          ...(bounds !== undefined
            ? { locationRestriction: rectangle(bounds) }
            : focus !== undefined
              ? {
                  locationBias: {
                    circle: {
                      center: { latitude: focus.lat, longitude: focus.lon },
                      radius: FOCUS_RADIUS_M,
                    },
                  },
                }
              : {}),
        },
        idempotent: true,
      }).withResponse();
      return {
        results: ofTypes((answer.data.places ?? []).map(toDetailedPlace), request.types),
        raw: answer.data,
        response: answer.response,
        requestId: answer.requestId,
      };
    },
    async lookup(request, call) {
      const query = {
        languageCode: request.language?.[0],
        sessionToken: request.session,
      };
      const shared = masked(fieldMask(request.include, PLACE_PATHS, PLACE_INCLUDES, ""), call);
      const failures: unknown[] = [];
      let response: Response | undefined;
      let requestId: string | undefined;
      const answers = await pool(
        request.ids,
        LOOKUPS,
        async (id): Promise<Result | undefined> => {
          try {
            const answer = await places<Result>({
              ...shared,
              path: `/v1/places/${encodeURIComponent(id)}`,
              query,
            }).withResponse();
            response = answer.response;
            requestId = answer.requestId;
            return answer.data;
          } catch (error) {
            // An ID Google no longer knows answers nothing, like an ID that never matched.
            if (error instanceof NotFoundError) return undefined;
            throw error;
          }
        },
        (error) => {
          failures.push(error);
          return undefined;
        },
      );
      if (failures.length > 0) throw failures[0];
      const found = answers.filter((answer) => answer !== undefined);
      return {
        results: found.map(toDetailedPlace),
        // One body per ID found, since each ID is its own request.
        raw: found,
        response,
        requestId,
      };
    },
    errorCode(error) {
      const failure = (error.body as ErrorBody | null | undefined)?.error;
      // A rejected key answers 400 INVALID_ARGUMENT, which would read as a malformed request.
      if (failure?.details?.some((detail) => detail.reason === "API_KEY_INVALID"))
        return "unauthenticated";
      return ERRORS.get(failure?.status ?? "");
    },
  };
}
