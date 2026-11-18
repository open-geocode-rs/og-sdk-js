/**
 * The adapter for Mapbox, over Geocoding v6 and Search Box v1.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { mapbox } from "@open-geocode/client/mapbox";
 * const geo = new Geocoder({ adapter: mapbox({ accessToken: "pk..." }) });
 * ```
 *
 * `geocode`, `reverse` and both batches use Geocoding v6.
 * `autocomplete`, `places` and `lookup` use Search Box.
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
  type OperationCapabilities,
  pool,
  text,
} from "./adapter.ts";
import type { WithResponse } from "./core.ts";
import { NotFoundError, OgError } from "./errors.ts";
import type {
  Accuracy,
  Attribution,
  BaseRequest,
  Brand,
  BusinessStatus,
  Category,
  Contact,
  Context,
  ContextArea,
  FieldName,
  LatLon,
  Match,
  MatchStatus,
  OpeningHours,
  PlaceRecord,
  PlaceType,
  Rating,
  StructuredAddress,
} from "./types.ts";

/** Options for {@link mapbox}. */
export interface MapboxOptions extends AdapterOptions {
  /** A Mapbox access token. It is sent as the `access_token` query parameter. */
  accessToken: string;
  /** Where the Mapbox API is reached. Default `https://api.mapbox.com`. */
  baseUrl?: string | undefined;
  /**
   * The most queries sent in one batch request. Default 50.
   * Mapbox documents both 50 and 1000 as the limit, so raise it only if your account accepts more.
   */
  batchSize?: number | undefined;
  /**
   * Whether you intend to store the answers of geocode, reverse and batch calls.
   * `true` sends Mapbox's `permanent=true`, which Mapbox bills and licenses differently, and lets a cache keep those answers.
   * Without it Mapbox answers are for temporary use, and a cache keeps none of them.
   * Suggestions, place search and lookup are for temporary use either way.
   * See https://docs.mapbox.com/api/search/geocoding/#storing-geocoding-results.
   */
  permanent?: boolean | undefined;
}

/** Mapbox's own API. */
export interface MapboxNative {
  /** Sends any request to `api.mapbox.com` with the access token applied. */
  request: NativeRequest;
}

interface Layer {
  /** The layer's ID in Geocoding v6. */
  mapbox_id?: string;
  /** The layer's ID in Search Box. */
  id?: string;
  name?: string;
  wikidata_id?: string;
  region_code?: string;
  region_code_full?: string;
  country_code?: string;
  address_number?: string;
  street_name?: string;
  designator?: string;
  identifier?: string;
  translations?: Record<string, { name?: string }>;
}

type LayerName =
  | "address"
  | "secondary_address"
  | "street"
  | "neighborhood"
  | "postcode"
  | "locality"
  | "place"
  | "district"
  | "region"
  | "country";

interface Metadata {
  phone?: string;
  website?: string;
  email?: string;
  rating?: number;
  review_count?: number;
  open_hours?: { weekday_text?: string[] };
}

/** The properties of a feature. A Search Box suggestion has the same shape, without `coordinates`. */
interface Properties {
  mapbox_id?: string;
  feature_type?: string;
  name?: string;
  name_preferred?: string;
  place_formatted?: string;
  full_address?: string;
  context?: Partial<Record<LayerName, Layer>>;
  coordinates?: {
    longitude?: number;
    latitude?: number;
    accuracy?: string;
    routable_points?: { name?: string; longitude: number; latitude: number }[];
  };
  bbox?: number[];
  match_code?: Record<string, string>;
  poi_category?: string[];
  poi_category_ids?: string[];
  brand?: string[];
  brand_id?: string[];
  metadata?: Metadata;
  operational_status?: string;
  distance?: number;
}

interface Feature {
  geometry?: { coordinates?: number[] };
  properties: Properties;
}

interface Collection {
  features?: Feature[];
  attribution?: string;
}

interface Suggestions {
  suggestions?: Properties[];
  attribution?: string;
}

interface Batch {
  batch?: Collection[];
}

const TYPES: Record<string, PlaceType> = {
  address: "address",
  secondary_address: "address",
  street: "street",
  poi: "poi",
  postcode: "postcode",
  neighborhood: "neighbourhood",
  place: "locality",
  // Mapbox's locality is an official part of a city, a tier the unified types do not list.
  locality: "area",
  block: "area",
  district: "district",
  region: "region",
  country: "country",
};

/** The Geocoding v6 feature type that holds exactly one unified type. */
const GEOCODING_TYPES: Partial<Record<PlaceType, string>> = {
  address: "address",
  street: "street",
  // An intersection is a street feature, told apart by its accuracy once it is back.
  intersection: "street",
  postcode: "postcode",
  neighbourhood: "neighborhood",
  locality: "place",
  district: "district",
  region: "region",
  country: "country",
};

const SEARCH_BOX_TYPES: Partial<Record<PlaceType, string>> = { ...GEOCODING_TYPES, poi: "poi" };

/** Every Search Box type but `category`, so that `/suggest` sends places only. */
const SUGGEST_TYPES =
  "country,region,postcode,district,place,locality,neighborhood,block,street,address,poi";

/** Suggestions that name a search to run, not a place. */
const NOT_PLACES: ReadonlySet<string | undefined> = new Set(["category", "brand"]);

const ACCURACY: Record<string, Accuracy> = {
  // All three place the address itself, on its building, its parcel or its surveyed point.
  rooftop: "rooftop",
  parcel: "rooftop",
  point: "rooftop",
  interpolated: "interpolated",
  intersection: "street",
  street: "street",
  approximate: "approximate",
};

const MATCH_STATUS: Record<string, MatchStatus> = {
  matched: "matched",
  unmatched: "unmatched",
  not_applicable: "not_applicable",
  inferred: "inferred",
  // Mapbox's word for a house number it interpolated or a unit it extrapolated.
  plausible: "partial",
};

const MATCH_PARTS: Record<string, keyof Match["components"]> = {
  address_number: "houseNumber",
  street: "street",
  secondary_address: "unit",
  place: "locality",
  district: "district",
  region: "region",
  postcode: "postcode",
  country: "country",
};

const BUSINESS_STATUS: Record<string, BusinessStatus> = {
  active: "operational",
  // Mapbox returns a closed POI only under `show_closed_pois`, which it defines as permanently closed.
  closed: "closed_permanently",
};

const GEOCODING_FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "address",
  "bbox",
  "context",
  "addressDetails",
  "accessPoints",
];
const POI_FIELDS: readonly FieldName[] = [
  "categories",
  "brand",
  "contact",
  "openingHours",
  "rating",
  "businessStatus",
];
const SEARCH_BOX_FIELDS: readonly FieldName[] = [...GEOCODING_FIELDS, ...POI_FIELDS];

const geocoding = (fields: readonly FieldName[]): OperationCapabilities["fields"] => [
  ...GEOCODING_FIELDS,
  ...fields,
];

/**
 * A layer's name in each further language asked for, by language code.
 * Mapbox lists every language asked for, the first among them, and the first already names the layer.
 */
function translated(
  layer: Layer | undefined,
  first: string | undefined,
): Record<string, string> | null {
  if (layer?.translations === undefined) return null;
  const names = Object.entries(layer.translations).flatMap(([language, { name }]) =>
    name === undefined || language.toLowerCase() === first?.toLowerCase() ? [] : [[language, name]],
  );
  return names.length > 0 ? (Object.fromEntries(names) as Record<string, string>) : null;
}

function area(
  layer: Layer | undefined,
  first: string | undefined,
  code?: string,
): ContextArea | null {
  const name = text(layer?.name);
  if (layer === undefined || name === null) return null;
  return {
    name,
    // Search Box sends an empty string for an ID it does not have.
    id: text(layer.mapbox_id) ?? text(layer.id),
    code: text(code),
    wikidata: text(layer.wikidata_id),
    translations: translated(layer, first),
  };
}

function match(code: Record<string, string> | undefined): Match | null {
  if (code === undefined) return null;
  const components: Match["components"] = {};
  for (const [key, part] of Object.entries(MATCH_PARTS)) {
    const status = MATCH_STATUS[code[key] ?? ""];
    if (status !== undefined) components[part] = status;
  }
  return { score: null, label: text(code.confidence), components };
}

function categories(names: readonly string[] = [], ids: readonly string[] = []): Category[] | null {
  if (names.length === 0 && ids.length === 0) return null;
  // Mapbox does not say the two lists run in step, so they are paired only when they line up.
  if (names.length === ids.length)
    return names.map((name, index) => ({ id: ids[index] ?? null, name, primary: false }));
  return [
    ...names.map((name) => ({ id: null, name, primary: false })),
    ...ids.map((id) => ({ id, name: null, primary: false })),
  ];
}

function brand(names: readonly string[] = [], ids: readonly string[] = []): Brand | null {
  // The further names are the same chain in other scripts.
  const name = text(names[0]);
  return name === null ? null : { name, id: text(ids[0]), wikidata: null };
}

function contact(metadata: Metadata | undefined): Contact | null {
  const found: Contact = {
    phone: text(metadata?.phone),
    website: text(metadata?.website),
    email: text(metadata?.email),
  };
  return found.phone === null && found.website === null && found.email === null ? null : found;
}

function openingHours(metadata: Metadata | undefined): OpeningHours | null {
  // Only Mapbox's own display lines are passed on. Its `periods` are left in `raw`.
  const lines = metadata?.open_hours?.weekday_text;
  return lines?.length ? { text: [...lines], openNow: null } : null;
}

function rating(metadata: Metadata | undefined): Rating | null {
  return typeof metadata?.rating === "number"
    ? { value: metadata.rating, count: metadata.review_count ?? null }
    : null;
}

function label(p: Properties, name: string): string {
  const rest = text(p.full_address) ?? text(p.place_formatted);
  if (rest === null) return name;
  // A POI's `full_address` is its street address, without its name.
  if (p.feature_type === "poi") return `${name}, ${rest}`;
  // Mapbox defines `full_address` as the name followed by `place_formatted`.
  return text(p.full_address) ?? `${text(p.name_preferred) ?? name}, ${rest}`;
}

/**
 * One feature or suggestion as a place.
 * `position` is the feature's GeoJSON point, and `first` the language that names the answer.
 */
function toPlace(
  p: Properties,
  raw: unknown,
  position?: readonly number[],
  first?: string,
): PlaceRecord {
  const around = p.context ?? {};
  // An area's own names in other languages are on its entry in its own context, found by its ID.
  const self =
    p.mapbox_id === undefined
      ? undefined
      : Object.values(around).find((layer) => layer?.mapbox_id === p.mapbox_id);
  const precision = p.coordinates?.accuracy;
  const type: PlaceType =
    p.feature_type === "street" && precision === "intersection"
      ? "intersection"
      : (TYPES[p.feature_type ?? ""] ?? "unknown");
  const name = p.name ?? "";
  // A feature may be left out of its own context, so an area names its own tier.
  const own = (layer: LayerName): string | null =>
    p.feature_type === layer && type !== "intersection" ? text(name) : null;
  const lon = position?.[0] ?? p.coordinates?.longitude;
  const lat = position?.[1] ?? p.coordinates?.latitude;
  const location = lon === undefined || lat === undefined ? null : { lat, lon };

  const address = emptyAddress();
  address.houseNumber = text(around.address?.address_number);
  address.street = text(around.address?.street_name) ?? text(around.street?.name) ?? own("street");
  address.unit = text(around.secondary_address?.identifier);
  address.neighbourhood = text(around.neighborhood?.name) ?? own("neighborhood");
  address.locality = text(around.place?.name) ?? own("place");
  address.district = text(around.district?.name) ?? own("district");
  address.region = text(around.region?.name) ?? own("region");
  address.regionCode = text(around.region?.region_code);
  address.postcode = text(around.postcode?.name) ?? own("postcode");
  address.country = text(around.country?.name) ?? own("country");
  // Upper case is the unified form of the same ISO code.
  address.countryCode = text(around.country?.country_code)?.toUpperCase() ?? null;

  const context: Context = {
    neighbourhood: area(around.neighborhood, first),
    sublocality: area(around.locality, first),
    locality: area(around.place, first),
    district: area(around.district, first),
    region: area(around.region, first, around.region?.region_code_full),
    country: area(around.country, first, address.countryCode ?? undefined),
  };
  const points = p.coordinates?.routable_points;
  return {
    id: text(p.mapbox_id),
    type,
    name,
    label: label(p, name),
    location,
    accuracy: (precision === undefined ? undefined : ACCURACY[precision]) ?? null,
    confidence: null,
    // Search Box sends a distance. Geocoding sends none, and the Geocoder measures it.
    distance: p.distance ?? null,
    address,
    bbox: p.bbox?.length === 4 ? (p.bbox as [number, number, number, number]) : null,
    context,
    addressDetails: {
      unitType: text(around.secondary_address?.designator),
      building: null,
      floor: null,
      sublocality: text(around.locality?.name),
      postcodeSuffix: null,
    },
    accessPoints: points?.length
      ? points.map((point) => ({
          lat: point.latitude,
          lon: point.longitude,
          kind: text(point.name),
        }))
      : null,
    match: match(p.match_code),
    translations: translated(self, first),
    categories: categories(p.poi_category, p.poi_category_ids),
    brand: brand(p.brand, p.brand_id),
    contact: contact(p.metadata),
    openingHours: openingHours(p.metadata),
    rating: rating(p.metadata),
    businessStatus:
      (p.operational_status === undefined ? undefined : BUSINESS_STATUS[p.operational_status]) ??
      null,
    raw,
  };
}

/** The places of a response, less what is not a place and what the caller's `types` leave out. */
function toPlaces(
  records: readonly { properties: Properties; raw: unknown; position?: readonly number[] }[],
  request: BaseRequest,
): PlaceRecord[] {
  const places = records
    .filter((record) => !NOT_PLACES.has(record.properties.feature_type))
    .map((record) =>
      toPlace(record.properties, record.raw, record.position, request.language?.[0]),
    );
  const { types } = request;
  // Mapbox's types are coarser than the unified ones, so the exact filter is applied here.
  return types === undefined ? places : places.filter((place) => types.includes(place.type));
}

function features(body: Collection, request: BaseRequest): PlaceRecord[] {
  return toPlaces(
    (body.features ?? []).map((feature) => ({
      properties: feature.properties,
      raw: feature,
      ...(feature.geometry?.coordinates ? { position: feature.geometry.coordinates } : {}),
    })),
    request,
  );
}

function credits(notice: string | undefined): Attribution[] {
  if (!notice) return [];
  // The link is the one inside Mapbox's own notice.
  return [{ text: notice, url: /https?:\/\/[^\s)]+/.exec(notice)?.[0] ?? null, licence: null }];
}

/** The Mapbox `types` value for the unified types, when every one of them has a Mapbox type. */
function typesOf(
  types: readonly PlaceType[] | undefined,
  names: Partial<Record<PlaceType, string>>,
): string | undefined {
  if (!types?.length) return undefined;
  const mapped = new Set<string>();
  for (const type of types) {
    const name = names[type];
    // A partial list would shut out the types Mapbox cannot be asked for.
    if (name === undefined) return undefined;
    mapped.add(name);
  }
  return [...mapped].join(",");
}

/** A limit Mapbox accepts. The `Geocoder` cuts the results to the caller's own number. */
const clamp = (limit: number, max: number): number => Math.max(1, Math.min(Math.trunc(limit), max));

/** The parameters every forward search shares, under the names both Mapbox APIs use. */
function filters(
  request: BaseRequest,
  names: Partial<Record<PlaceType, string>>,
): Record<string, unknown> {
  const types = typesOf(request.types, names);
  return {
    ...(request.limit === undefined ? {} : { limit: clamp(request.limit, 10) }),
    ...(request.language?.length ? { language: request.language.join(",") } : {}),
    ...(request.countries?.length ? { country: request.countries.join(",") } : {}),
    ...(request.focus ? { proximity: `${request.focus.lon},${request.focus.lat}` } : {}),
    ...(request.bounds ? { bbox: request.bounds.join(",") } : {}),
    ...(types === undefined ? {} : { types }),
  };
}

/** One forward query of Geocoding v6, for the URL or for a batch body. */
function forward(
  request: BaseRequest,
  item: { query?: string | undefined; address?: StructuredAddress | undefined },
): Record<string, unknown> {
  const options = {
    ...filters(request, GEOCODING_TYPES),
    // Prefix matching is for text still being typed. A geocode query is complete.
    autocomplete: false,
    // Entrances are extra data, so they are asked for only on request.
    ...(request.include.includes("accessPoints") ? { entrances: true } : {}),
  };
  const parts = item.address;
  if (parts === undefined) return { q: item.query ?? "", ...options };
  return {
    ...(parts.address === undefined
      ? { address_number: parts.houseNumber, street: parts.street }
      : { address_line1: parts.address }),
    place: parts.locality,
    region: parts.region,
    postcode: parts.postcode,
    // One parameter carries both, and the caller's country filter is the stricter of the two.
    ...(request.countries?.length ? {} : { country: parts.country }),
    ...options,
  };
}

/** One reverse query of Geocoding v6, for the URL or for a batch body. */
function backward(request: BaseRequest, point: LatLon): Record<string, unknown> {
  const types = typesOf(request.types, GEOCODING_TYPES);
  return {
    longitude: point.lon,
    latitude: point.lat,
    ...(request.language?.length ? { language: request.language.join(",") } : {}),
    ...(request.countries?.length ? { country: request.countries.join(",") } : {}),
    ...(types === undefined ? {} : { types }),
    // Mapbox rejects a reverse limit above one unless exactly one type is asked for.
    ...(request.limit === undefined || types === undefined || types.includes(",")
      ? {}
      : { limit: clamp(request.limit, 5) }),
  };
}

function collection(answer: WithResponse<Collection>, base: BaseRequest): AdapterResult {
  return {
    results: features(answer.data, base),
    attribution: credits(answer.data.attribution),
    raw: answer.data,
    response: answer.response,
    requestId: answer.requestId,
  };
}

/** The Mapbox adapter. Its `native.request` reaches any Mapbox API with the same token. */
export function mapbox(options: MapboxOptions): Adapter<MapboxNative> {
  const transport = createTransport(options, {
    name: "mapbox",
    baseUrl: options.baseUrl ?? "https://api.mapbox.com",
    describeError: (body) =>
      text((body as { message?: unknown } | null | undefined)?.message) ?? undefined,
  });
  const request = nativeRequest(transport, ({ query }) => {
    query.set("access_token", options.accessToken);
  });
  const batchSize = Math.max(1, Math.trunc(options.batchSize ?? 50));
  const stored = options.permanent === true ? { permanent: true } : {};
  // An answer asked for as permanent may be kept without limit, and any other not at all.
  const kept = options.permanent === true ? { cache: { maxTtl: Infinity } } : {};

  /** Runs queries through `/batch` in chunks. A chunk that fails fails its own items only. */
  async function batch(
    queries: readonly Record<string, unknown>[],
    context: BatchContext,
  ): Promise<AdapterBatchItem[]> {
    let done = 0;
    const finished = (count: number): void => {
      done += count;
      context.onProgress(done, queries.length);
    };
    const answers = await pool(
      chunk(queries, batchSize),
      context.concurrency,
      async (rows, at): Promise<AdapterBatchItem[]> => {
        const body = await request<Batch>({
          ...context.options,
          method: "POST",
          path: "/search/geocode/v6/batch",
          query: stored,
          body: rows,
          // A batch only reads, so a retry repeats it safely.
          idempotent: true,
        });
        const items = rows.map((_, offset): AdapterBatchItem => {
          const index = at * batchSize + offset;
          const slot = body.batch?.[offset];
          return slot === undefined
            ? {
                index,
                results: [],
                error: new OgError("mapbox sent no answer for this query.", {
                  provider: "mapbox",
                  body,
                }),
              }
            : { index, results: features(slot, context.request) };
        });
        finished(rows.length);
        return items;
      },
      (error, rows, at): AdapterBatchItem[] => {
        finished(rows.length);
        return rows.map((_, offset) => ({ index: at * batchSize + offset, results: [], error }));
      },
    );
    return answers.flat();
  }

  return {
    id: "mapbox",
    native: { request },
    capabilities: {
      geocode: {
        options: ["limit", "language", "countries", "focus", "bounds", "types", "structured"],
        fields: geocoding(["match", "translations"]),
        ...kept,
      },
      reverse: {
        options: ["limit", "language", "countries", "types"],
        fields: geocoding(["translations"]),
        ...kept,
      },
      autocomplete: {
        options: ["limit", "language", "countries", "focus", "bounds", "types", "session"],
        fields: ["id", "distance", "address", "context", "addressDetails", ...POI_FIELDS],
        coordinates: false,
      },
      places: {
        options: ["limit", "language", "countries", "focus", "bounds", "types"],
        fields: [...SEARCH_BOX_FIELDS, "distance"],
      },
      lookup: { options: ["language", "session"], fields: SEARCH_BOX_FIELDS },
      batch: { geocode: true, reverse: true },
      cache: { maxTtl: 0 },
    },
    async geocode(base, call) {
      const answer = await request<Collection>({
        ...call,
        path: "/search/geocode/v6/forward",
        query: { ...forward(base, base), ...stored },
      }).withResponse();
      return collection(answer, base);
    },
    async reverse(base, call) {
      const answer = await request<Collection>({
        ...call,
        path: "/search/geocode/v6/reverse",
        query: { ...backward(base, base.point), ...stored },
      }).withResponse();
      return collection(answer, base);
    },
    async autocomplete(base, call) {
      const answer = await request<Suggestions>({
        ...call,
        path: "/search/searchbox/v1/suggest",
        query: {
          q: base.query,
          types: SUGGEST_TYPES,
          ...filters(base, SEARCH_BOX_TYPES),
          // Mapbox requires a session, so a call without one is a session of its own.
          session_token: base.session ?? crypto.randomUUID(),
        },
      }).withResponse();
      return {
        results: toPlaces(
          (answer.data.suggestions ?? []).map((suggestion) => ({
            properties: suggestion,
            raw: suggestion,
          })),
          base,
        ),
        attribution: credits(answer.data.attribution),
        raw: answer.data,
        response: answer.response,
        requestId: answer.requestId,
      };
    },
    async places(base, call) {
      const answer = await request<Collection>({
        ...call,
        path: "/search/searchbox/v1/forward",
        query: { q: base.query, ...filters(base, SEARCH_BOX_TYPES) },
      }).withResponse();
      return collection(answer, base);
    },
    async lookup(base, call) {
      const asked = (...fields: FieldName[]): boolean =>
        fields.some((field) => (base.include as FieldName[]).includes(field));
      // Mapbox sends these parts of a record only when their attribute set is asked for.
      const sets = [
        ...(asked("contact", "openingHours") ? ["visit"] : []),
        ...(asked("rating") ? ["venue"] : []),
      ];
      const failures: unknown[] = [];
      const answers = await pool(
        base.ids,
        4,
        async (id): Promise<Partial<WithResponse<Collection>> & { body: unknown }> => {
          try {
            const answer = await request<Collection>({
              ...call,
              path: `/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`,
              query: {
                ...(base.language?.length ? { language: base.language.join(",") } : {}),
                ...(sets.length > 0 ? { attribute_sets: sets.join(",") } : {}),
                session_token: base.session ?? crypto.randomUUID(),
              },
            }).withResponse();
            return { ...answer, body: answer.data };
          } catch (error) {
            // An ID Mapbox does not know answers nothing.
            if (error instanceof NotFoundError) return { body: error.body };
            throw error;
          }
        },
        (error) => {
          failures.push(error);
          return { body: undefined };
        },
      );
      if (failures.length > 0) throw failures[0];
      const last = answers.filter((answer) => answer.response !== undefined).at(-1);
      return {
        results: answers.flatMap((answer) => (answer.data ? features(answer.data, base) : [])),
        attribution: credits(last?.data?.attribution),
        // One body per ID, in the order asked.
        raw: answers.map((answer) => answer.body),
        response: last?.response,
        requestId: last?.requestId,
      };
    },
    batch: {
      geocode(items, context) {
        return batch(
          items.map((item) => forward(context.request, item)),
          context,
        );
      },
      reverse(items, context) {
        return batch(
          items.map((item) => backward(context.request, item)),
          context,
        );
      },
    },
    errorCode(error, operation) {
      // Mapbox answers 422 to a batch that is too long, which the status alone reads as malformed.
      return operation === "batch" &&
        error.status === 422 &&
        error.message.startsWith("Batch queries must include")
        ? "payload_too_large"
        : undefined;
    },
  };
}
