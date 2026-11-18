/**
 * The adapter for og's native API.
 *
 * ```ts
 * import { Geocoder } from "@open-geocode/client";
 * import { og } from "@open-geocode/client/og";
 * const geo = new Geocoder({ adapter: og({ baseUrl: "http://localhost:8080" }) });
 * ```
 */
import {
  type Adapter,
  type AdapterBatchItem,
  type AdapterOptions,
  type AdapterResult,
  type BatchContext,
  emptyAddress,
  type OperationCapabilities,
  streetLine,
  toStringRanges,
  utcOffsetMinutes,
} from "./adapter.ts";
import {
  type Client,
  createClient,
  type ForwardCollection,
  type ReverseCollection,
} from "./client.ts";
import type { RequestOptions, WithResponse } from "./core.ts";
import { OgError } from "./errors.ts";
import type { components } from "./schema.gen.ts";
import type {
  Attribution,
  BBox,
  Match,
  Operation,
  BaseRequest,
  Context,
  ContextArea,
  FieldName,
  OptionName,
  PlaceRecord,
  PlaceType,
} from "./types.ts";

export { createClient } from "./client.ts";
export type * from "./client.ts";
export type { components, operations, paths } from "./schema.gen.ts";

/** Options for {@link og}. */
export interface OgOptions extends AdapterOptions {
  /** Where og runs, for example `http://localhost:8080`. */
  baseUrl: string;
}

type Layer = components["schemas"]["Layer"];
type Feature = ForwardCollection["features"][number] | ReverseCollection["features"][number];
type Area = components["schemas"]["ContextArea"];

const TYPES: Record<Layer, PlaceType> = {
  address: "address",
  interpolation: "address",
  street: "street",
  poi: "poi",
  postcode: "postcode",
  neighbourhood: "neighbourhood",
  locality: "locality",
  district: "district",
  region: "region",
  country: "country",
  place: "area",
};

/** The og layer that holds a unified type, where exactly one does. */
const LAYERS: Partial<Record<PlaceType, Layer>> = {
  street: "street",
  poi: "poi",
  postcode: "postcode",
  neighbourhood: "neighbourhood",
  locality: "locality",
  district: "district",
  region: "region",
  country: "country",
  area: "place",
};

const FIELDS: readonly FieldName[] = [
  "id",
  "location",
  "accuracy",
  "confidence",
  "address",
  "context",
  "addressDetails",
  "streetParts",
  "categories",
  "brand",
  "translations",
];
const SEARCH: readonly OptionName[] = [
  "limit",
  "language",
  "countries",
  "focus",
  "bounds",
  "types",
];

/**
 * The fields og fills on each operation, beyond `FIELDS`.
 * og's server returns most of them wherever a record appears. The adapter claims and fills
 * each one only on the operations where it was added to og, so the unified answer of an
 * operation holds what that operation is documented to return and nothing more.
 */
const EXTRA: Record<Operation, readonly FieldName[]> = {
  geocode: ["distance", "bbox", "addressLines", "accessPoints", "match"],
  reverse: ["distance", "bbox", "addressLines", "accessPoints"],
  autocomplete: ["distance", "contact", "openingHours", "highlights"],
  places: ["distance", "bbox", "contact", "openingHours", "timezone", "accessPoints"],
  lookup: ["bbox", "addressLines", "contact", "openingHours", "timezone", "accessPoints"],
};

const filled = (operation: Operation): readonly FieldName[] => [...FIELDS, ...EXTRA[operation]];

const capability = (
  operation: Operation,
  options: readonly OptionName[],
): OperationCapabilities => ({ options, fields: filled(operation) });

const MATCH_PARTS = {
  housenumber: "houseNumber",
  street: "street",
  unit: "unit",
  locality: "locality",
  region: "region",
  postcode: "postcode",
  country: "country",
} as const;

function area(source: Area | undefined): ContextArea | null {
  if (source === undefined) return null;
  return {
    name: source.name,
    id: source.id,
    code: source.code ?? null,
    wikidata: null,
    translations: source.translations ?? null,
  };
}

function toPlace(feature: Feature, operation: Operation): PlaceRecord {
  const p = feature.properties;
  const fills = (field: FieldName): boolean => EXTRA[operation].includes(field);
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const stated = p.address;
  const around = p.context;
  const type = TYPES[p.layer] ?? "unknown";
  // A result is not listed in its own context, so an area names its own tier.
  const own = (tier: PlaceType): string | undefined => (type === tier ? p.name : undefined);
  const regionCode = around?.region?.code;
  const address = emptyAddress();
  address.houseNumber = stated?.housenumber ?? null;
  address.street = stated?.street ?? own("street") ?? null;
  address.unit = stated?.unit ?? null;
  address.neighbourhood =
    around?.neighbourhood?.name ?? own("neighbourhood") ?? stated?.areas?.at(-1) ?? null;
  address.locality = stated?.locality ?? around?.locality?.name ?? own("locality") ?? null;
  address.district = around?.district?.name ?? around?.subregion?.name ?? own("district") ?? null;
  address.region = around?.region?.name ?? own("region") ?? stated?.region ?? null;
  address.regionCode = regionCode?.includes("-")
    ? regionCode.slice(regionCode.indexOf("-") + 1)
    : (regionCode ?? null);
  address.postcode = stated?.postcode ?? own("postcode") ?? null;
  address.country = around?.country?.name ?? own("country") ?? null;
  address.countryCode = around?.country?.code?.toUpperCase() ?? null;
  const context: Context = {
    neighbourhood: area(around?.neighbourhood),
    sublocality: area(around?.sublocality),
    locality: area(around?.locality),
    district: area(around?.district ?? around?.subregion),
    region: area(around?.region),
    country: area(around?.country),
  };
  const parts = stated?.street_parts;
  return {
    id: p.id,
    type,
    name: p.name,
    label: p.label,
    location: { lat, lon },
    accuracy: p.accuracy,
    confidence: "confidence" in p ? (p.confidence ?? null) : null,
    distance: p.distance_m ?? null,
    address,
    context,
    addressDetails: {
      unitType: stated?.unit_type ?? null,
      building: null,
      floor: null,
      sublocality: around?.sublocality?.name ?? null,
      postcodeSuffix: null,
    },
    streetParts: parts
      ? {
          prefix: parts.prefix ?? null,
          name: parts.name,
          type: parts.type ?? null,
          suffix: parts.suffix ?? null,
        }
      : null,
    categories: p.category ? [{ id: p.category, name: null, primary: true }] : null,
    brand: p.brand ? { name: p.brand.name, id: null, wikidata: p.brand.wikidata ?? null } : null,
    translations: p.translations ?? null,
    bbox: fills("bbox") && p.bbox?.length === 4 ? (p.bbox as BBox) : null,
    addressLines: fills("addressLines") && p.address_lines?.length ? p.address_lines : null,
    accessPoints:
      fills("accessPoints") && p.access?.length
        ? p.access.map((point) => ({ lat: point.lat, lon: point.lon, kind: point.kind }))
        : null,
    contact:
      fills("contact") && p.contact
        ? {
            phone: p.contact.phone ?? null,
            website: p.contact.website ?? null,
            email: p.contact.email ?? null,
          }
        : null,
    // og returns the hours as the source writes them, unparsed, so it cannot say open or shut.
    openingHours:
      fills("openingHours") && p.opening_hours ? { text: [p.opening_hours], openNow: null } : null,
    // og names the zone, and the runtime's own rules give the offset, so og ships no rules to go stale.
    timezone:
      fills("timezone") && p.timezone
        ? { name: p.timezone, utcOffsetMinutes: utcOffsetMinutes(p.timezone) }
        : null,
    match: fills("match") && "match" in p && p.match ? toMatch(p.match) : null,
    // og counts in Unicode characters, and a JavaScript string in UTF-16 units.
    highlights:
      fills("highlights") && "highlights" in p && p.highlights?.length
        ? toStringRanges(p.label, p.highlights)
        : null,
    raw: feature,
  };
}

function toMatch(source: components["schemas"]["QueryMatch"]): Match {
  const parts: Match["components"] = {};
  for (const [key, part] of Object.entries(MATCH_PARTS)) {
    const status = source[key as keyof typeof MATCH_PARTS];
    if (status !== undefined) parts[part] = status;
  }
  return { score: null, label: null, components: parts };
}

function credits(collection: ForwardCollection | ReverseCollection): Attribution[] {
  // A server older than the attribution field sends none.
  return (collection.geocoding.attribution ?? []).map((credit) => ({
    text: credit.text,
    url: credit.url ?? null,
    licence: credit.licence ?? null,
  }));
}

function result(
  answer: WithResponse<ForwardCollection | ReverseCollection>,
  types: readonly PlaceType[] | undefined,
  operation: Operation,
): AdapterResult {
  let results = answer.data.features.map((feature) => toPlace(feature, operation));
  // og filters by one layer at most, so a longer list is applied here.
  if (types !== undefined) results = results.filter((place) => types.includes(place.type));
  return {
    results,
    attribution: credits(answer.data),
    raw: answer.data,
    response: answer.response,
    requestId: answer.requestId,
  };
}

/** The query parameters every og search shares. */
function common(request: BaseRequest): {
  limit?: number;
  lang?: string;
  country?: string;
  focus?: string;
  bbox?: string;
} {
  return {
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.language?.length ? { lang: request.language.join(",") } : {}),
    ...(request.countries?.length ? { country: request.countries.join(",") } : {}),
    ...(request.focus ? { focus: `${request.focus.lon},${request.focus.lat}` } : {}),
    ...(request.bounds ? { bbox: request.bounds.join(",") } : {}),
  };
}

/** `layer` when the types asked for are exactly one og layer. */
function layerOf(types: readonly PlaceType[] | undefined): { layer?: Layer } {
  const only = types?.length === 1 ? types[0] : undefined;
  // `address` spans two og layers, measured and interpolated, so it is filtered here instead.
  const layer = only === undefined ? undefined : LAYERS[only];
  return layer === undefined ? {} : { layer };
}

/** One row of a job's JSONL results. */
interface JobRow {
  row: number;
  status: number;
  response?: ForwardCollection | ReverseCollection;
  error?: components["schemas"]["Problem"];
}

/** The og adapter. Its `native` is the typed client for og's own API. */
export function og(options: OgOptions): Adapter<Client> {
  const client = createClient(options);

  /** Runs rows through `/jobs` and reads the results as og writes them. */
  async function job(
    endpoint: "geocode" | "reverse",
    rows: readonly Record<string, unknown>[],
    context: BatchContext,
  ): Promise<AdapterBatchItem[]> {
    const call: RequestOptions | undefined = context.options;
    const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
    const created = await client.jobs.create({ jsonl }, { endpoint }, { ...call, output: "jsonl" });
    const items: AdapterBatchItem[] = [];
    try {
      for await (const line of client.jobs.lines(created.id, call)) {
        const row = JSON.parse(line) as JobRow;
        items.push(
          row.response === undefined
            ? {
                index: row.row,
                results: [],
                error: OgError.fromResponse(row.status, row.error, new Headers()),
              }
            : {
                index: row.row,
                results: result(
                  { data: row.response, response: undefined as never, requestId: undefined },
                  context.request.types,
                  endpoint,
                ).results,
              },
        );
        context.onProgress(items.length, rows.length);
      }
      const final = await client.jobs.status(created.id, call);
      if (final.status === "failed" || final.status === "cancelled")
        throw new OgError(final.error ?? `og job ${created.id} was ${final.status}.`, {
          provider: "og",
          body: final,
        });
    } finally {
      // The results are read, so the job need not wait out its retention on the server.
      await client.jobs.delete(created.id, { maxRetries: 0 }).catch(() => {});
    }
    return items;
  }

  return {
    id: "og",
    native: client,
    capabilities: {
      geocode: capability("geocode", [...SEARCH, "structured"]),
      reverse: capability("reverse", ["limit", "language", "types"]),
      autocomplete: { ...capability("autocomplete", SEARCH), coordinates: true },
      places: capability("places", SEARCH),
      lookup: capability("lookup", ["language"]),
      batch: { geocode: true, reverse: true },
      // The data is open and the server is your own, so an answer may be kept without limit.
      cache: { maxTtl: Infinity },
    },
    async geocode(request, call) {
      const params = { ...common(request), ...layerOf(request.types) };
      if (request.address !== undefined) {
        const { focus: _focus, bbox: _bbox, ...structured } = params;
        const { locality, region, postcode, country } = request.address;
        const answer = await client
          .geocode(
            {
              ...structured,
              address: streetLine(request.address),
              locality,
              region,
              postcode,
              // og's country is a filter of two-letter codes, so a country name cannot be sent.
              ...(country !== undefined && /^[A-Za-z]{2}$/.test(country) && !structured.country
                ? { country: country.toUpperCase() }
                : {}),
            },
            call,
          )
          .withResponse();
        return result(answer, request.types, "geocode");
      }
      const answer = await client.geocode({ ...params, q: request.query }, call).withResponse();
      return result(answer, request.types, "geocode");
    },
    async reverse(request, call) {
      const answer = await client
        .reverse(
          {
            lat: request.point.lat,
            lon: request.point.lon,
            ...(request.language?.length ? { lang: request.language.join(",") } : {}),
            ...layerOf(request.types),
          },
          call,
        )
        .withResponse();
      return result(answer, request.types, "reverse");
    },
    async autocomplete(request, call) {
      const answer = await client
        .autocomplete({ ...common(request), ...layerOf(request.types), q: request.query }, call)
        .withResponse();
      return result(answer, request.types, "autocomplete");
    },
    async places(request, call) {
      const answer = await client
        .places({ ...common(request), q: request.query }, call)
        .withResponse();
      return result(answer, request.types, "places");
    },
    async lookup(request, call) {
      const answer = await client
        .places(
          {
            ids: request.ids.join(","),
            ...(request.language?.length ? { lang: request.language.join(",") } : {}),
          },
          call,
        )
        .withResponse();
      return result(answer, undefined, "lookup");
    },
    batch: {
      geocode(items, context) {
        const shared = { ...common(context.request), ...layerOf(context.request.types) };
        return job(
          "geocode",
          items.map((item) => {
            if (item.address === undefined) return { ...shared, q: item.query ?? "" };
            const { focus: _focus, bbox: _bbox, ...structured } = shared;
            const { locality, region, postcode } = item.address;
            return {
              ...structured,
              address: streetLine(item.address),
              locality,
              region,
              postcode,
            };
          }),
          context,
        );
      },
      reverse(items, context) {
        const lang = context.request.language?.join(",");
        return job(
          "reverse",
          items.map((item) => ({
            lat: item.lat,
            lon: item.lon,
            ...(lang ? { lang } : {}),
            ...layerOf(context.request.types),
          })),
          context,
        );
      },
    },
  };
}
