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

const forward = (options: readonly OptionName[]): OperationCapabilities => ({
  options,
  fields: [...FIELDS, "distance"],
});

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

function toPlace(feature: Feature): PlaceRecord {
  const p = feature.properties;
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
    raw: feature,
  };
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
): AdapterResult {
  let results = answer.data.features.map(toPlace);
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
      geocode: forward([...SEARCH, "structured"]),
      reverse: { options: ["limit", "language", "types"], fields: [...FIELDS, "distance"] },
      autocomplete: { ...forward(SEARCH), coordinates: true },
      places: forward(SEARCH),
      lookup: { options: ["language"], fields: FIELDS },
      batch: { geocode: true, reverse: true },
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
        return result(answer, request.types);
      }
      const answer = await client.geocode({ ...params, q: request.query }, call).withResponse();
      return result(answer, request.types);
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
      return result(answer, request.types);
    },
    async autocomplete(request, call) {
      const answer = await client
        .autocomplete({ ...common(request), ...layerOf(request.types), q: request.query }, call)
        .withResponse();
      return result(answer, request.types);
    },
    async places(request, call) {
      const answer = await client
        .places({ ...common(request), q: request.query }, call)
        .withResponse();
      return result(answer, request.types);
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
      return result(answer, undefined);
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
