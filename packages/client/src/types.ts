/**
 * The unified request and response format, the same for every adapter.
 *
 * Three rules hold for every response.
 * 1. Every default field is always present. `null` means the provider gave no value for this record.
 * 2. An opt-in field is present only when `include` asks for it, and is `null` when the provider gave no value.
 * 3. `unavailable` names the fields this provider can never fill for this operation, so a `null`
 *    there means "cannot" and a `null` anywhere else means "no data for this record".
 * No value is ever made up to fill a gap.
 */
import type { RequestOptions } from "./core.ts";
import type { GeocoderError } from "./errors.ts";

/** The adapter that answered. Third-party adapters may use any other string. */
export type ProviderId = "og" | "google" | "mapbox" | "here" | "precisely" | (string & {});

/** A point in WGS 84 degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A box in WGS 84 degrees, in GeoJSON order. */
export type BBox = [west: number, south: number, east: number, north: number];

/**
 * What a result is.
 * `area` is a named area outside the listed tiers, such as an island.
 * `unknown` is a provider type with no equivalent here.
 */
export type PlaceType =
  | "address"
  | "street"
  | "intersection"
  | "poi"
  | "postcode"
  | "neighbourhood"
  | "locality"
  | "district"
  | "region"
  | "country"
  | "area"
  | "unknown";

/**
 * How precisely `location` places the result, most precise first.
 *
 * - `rooftop`: the address or POI itself.
 * - `interpolated`: a house number placed between known neighbours.
 * - `street`: a point on the street.
 * - `centroid`: the centre of an area.
 * - `approximate`: a point standing for something less precise.
 */
export type Accuracy = "rooftop" | "interpolated" | "street" | "centroid" | "approximate";

/** The address of a result, one value per part. A part the provider did not give is `null`. */
export interface Address {
  houseNumber: string | null;
  street: string | null;
  /** The unit, suite or apartment, as written. */
  unit: string | null;
  neighbourhood: string | null;
  /** City or town. */
  locality: string | null;
  /** County, prefecture or the like, between `region` and `locality`. */
  district: string | null;
  /** State or province. */
  region: string | null;
  /** The region's short code without the country, such as `ON` or `CA`. */
  regionCode: string | null;
  postcode: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2 code in upper case, such as `CA`. */
  countryCode: string | null;
}

/** One result, in the default lean shape. */
export interface Place {
  /** The provider's ID for the record, usable with `lookup` on the same provider. `null` when it has none. */
  id: string | null;
  type: PlaceType;
  /** Short name. House number and street for an address, else the name of the street, area or POI. */
  name: string;
  /** One-line display text. */
  label: string;
  /** `null` on a suggestion that carries no coordinates. Resolve it with `lookup`. */
  location: LatLon | null;
  accuracy: Accuracy | null;
  /** How sure the provider is that this is what the query asked for, from 0 to 1. */
  confidence: number | null;
  /**
   * Metres from the reverse point, or from `focus`.
   * The provider's own figure where it sends one, else the great-circle distance to `location`.
   */
  distance: number | null;
  address: Address;
}

/** One containing area. */
export interface ContextArea {
  name: string;
  /** The provider's ID for the area. */
  id: string | null;
  /** ISO 3166-1 alpha-2 on a country, ISO 3166-2 such as `CA-ON` below it. */
  code: string | null;
  /** The area's Wikidata item, such as `Q1904`. */
  wikidata: string | null;
  /** The area's name in each further language asked for. */
  translations: Record<string, string> | null;
}

/** The areas containing a result, by tier. A tier the provider did not give is `null`. */
export interface Context {
  neighbourhood: ContextArea | null;
  /** An official part of a city, above the neighbourhood. */
  sublocality: ContextArea | null;
  locality: ContextArea | null;
  district: ContextArea | null;
  region: ContextArea | null;
  country: ContextArea | null;
}

/** Address parts beyond the default set. */
export interface AddressDetails {
  /** The unit's designator as written, such as `Apt`. */
  unitType: string | null;
  building: string | null;
  floor: string | null;
  /** An official part of a city, above the neighbourhood. */
  sublocality: string | null;
  /** The postcode's extension, such as the last four digits of a ZIP+4. */
  postcodeSuffix: string | null;
}

/** A street name split into its parts, as written. */
export interface StreetParts {
  /** Direction before the name. */
  prefix: string | null;
  /** The street's own name, without type and directions. */
  name: string | null;
  /** Street type, such as `Street` or `Ave`. */
  type: string | null;
  /** Direction after the name. */
  suffix: string | null;
}

/** A POI category, in the provider's own vocabulary. */
export interface Category {
  /** The provider's ID or tag, such as `amenity:cafe` or `100-1100-0010`. */
  id: string | null;
  name: string | null;
  primary: boolean;
}

/** The chain a place belongs to. */
export interface Brand {
  name: string;
  /** The provider's ID for the chain. */
  id: string | null;
  wikidata: string | null;
}

export interface Contact {
  phone: string | null;
  website: string | null;
  email: string | null;
}

export interface OpeningHours {
  /** Display lines, one per day or rule, as the provider writes them. */
  text: string[];
  openNow: boolean | null;
}

export interface Rating {
  value: number;
  /** How many ratings `value` averages. */
  count: number | null;
}

/** Whether a business still operates. */
export type BusinessStatus = "operational" | "closed_temporarily" | "closed_permanently";

export interface Timezone {
  /** IANA name, such as `America/Toronto`. */
  name: string;
  /** Offset from UTC in minutes, at the time of the request. */
  utcOffsetMinutes: number | null;
}

/** A point to route to, such as an entrance or the spot on the road in front. */
export interface AccessPoint extends LatLon {
  /** The provider's label for the point, such as `default` or `delivery`. */
  kind: string | null;
}

/** How one address part of the query matched. */
export type MatchStatus = "matched" | "partial" | "unmatched" | "inferred" | "not_applicable";

/** How the query matched the result, part by part. */
export interface Match {
  /** How much of the query the result explains, from 0 to 1. */
  score: number | null;
  /** The provider's own grade of the match, where it grades in words, such as `exact` or `high`. */
  label: string | null;
  components: Partial<
    Record<
      | "houseNumber"
      | "street"
      | "unit"
      | "locality"
      | "district"
      | "region"
      | "postcode"
      | "country",
      MatchStatus
    >
  >;
}

/** A character range in `label`, end exclusive. */
export interface TextRange {
  start: number;
  end: number;
}

export interface PlusCode {
  global: string | null;
  compound: string | null;
}

/** The opt-in fields. Ask for them by name in `include`. */
export interface PlaceExtras {
  /** The box that frames the result on a map. */
  bbox: BBox;
  /** The containing areas with their IDs and codes. */
  context: Context;
  addressDetails: AddressDetails;
  /** The address as postal lines, top to bottom. */
  addressLines: string[];
  streetParts: StreetParts;
  categories: Category[];
  brand: Brand;
  contact: Contact;
  openingHours: OpeningHours;
  rating: Rating;
  businessStatus: BusinessStatus;
  timezone: Timezone;
  accessPoints: AccessPoint[];
  match: Match;
  /** The parts of `label` that match what was typed. */
  highlights: TextRange[];
  /** The result's name in each further language asked for, by language code. */
  translations: Record<string, string>;
  plusCode: PlusCode;
  /** The provider's own record for this result, untouched. */
  raw: unknown;
}

/** The name of an opt-in field. */
export type Include = keyof PlaceExtras;

/** A result with the opt-in fields `I`. */
export type PlaceWith<I extends Include = never> = Place & { [K in I]: PlaceExtras[K] | null };

/** A result as an adapter builds it, before the fields nobody asked for are dropped. */
export type PlaceRecord = Place & { [K in Include]?: PlaceExtras[K] | null | undefined };

/** A default field a provider may be unable to fill. */
export type CoreField = "id" | "location" | "accuracy" | "confidence" | "distance" | "address";

/** A field whose availability differs by provider. */
export type FieldName = CoreField | Include;

/** A request option whose support differs by provider. */
export type OptionName =
  | "limit"
  | "language"
  | "countries"
  | "focus"
  | "bounds"
  | "types"
  | "session"
  | "structured";

/** A data set an answer comes from, and how to credit it. */
export interface Attribution {
  text: string;
  url: string | null;
  licence: string | null;
}

/** The operations that answer with places. */
export type Operation = "geocode" | "reverse" | "autocomplete" | "places" | "lookup";

/** The answer to every operation. */
export type GeocodeResult<I extends Include = never> = {
  /** The adapter that answered. With `failover` it may differ from the one configured. */
  provider: ProviderId;
  operation: Operation;
  results: PlaceWith<I>[];
  /** Credits the provider asks to be shown with its results. */
  attribution: Attribution[];
  /** Fields this provider cannot fill for this operation. They are `null` on every result. */
  unavailable: FieldName[];
  /** Options of this call the provider could not honour, and so left out. */
  ignored: OptionName[];
} & ("raw" extends I ? { /** The provider's response body, untouched. */ raw: unknown } : unknown);

/** An address in parts. Give `address`, or `houseNumber` and `street`. */
export interface StructuredAddress {
  /** House number and street as written, such as `10 King St W`. */
  address?: string | undefined;
  houseNumber?: string | undefined;
  street?: string | undefined;
  locality?: string | undefined;
  region?: string | undefined;
  postcode?: string | undefined;
  /** ISO 3166-1 alpha-2 code, or the country's name. */
  country?: string | undefined;
}

/** Options shared by the search operations. */
export interface SearchOptions<I extends Include = never> extends RequestOptions {
  /** The most results to return. */
  limit?: number | undefined;
  /**
   * BCP 47 language codes. The first names the results.
   * Each further one is answered in `translations`, where the provider has it.
   */
  language?: string | readonly string[] | undefined;
  /** Return only results in these countries, as ISO 3166-1 alpha-2 codes. */
  countries?: readonly string[] | undefined;
  /** Prefer results near this point. */
  focus?: LatLon | undefined;
  /** Return only results inside this box. */
  bounds?: BBox | undefined;
  /** Return only results of these types. */
  types?: readonly PlaceType[] | undefined;
  /** The opt-in fields to return. */
  include?: readonly I[] | undefined;
  /**
   * Groups the keystrokes of one search, and the `lookup` that ends it, into one billed session,
   * for providers that bill that way. Any unique string, such as `crypto.randomUUID()`.
   */
  session?: string | undefined;
}

/** Options for `reverse`. */
export type ReverseOptions<I extends Include = never> = Omit<
  SearchOptions<I>,
  "focus" | "bounds" | "countries" | "session"
>;

/** Options for `lookup`. */
export type LookupOptions<I extends Include = never> = Pick<
  SearchOptions<I>,
  "language" | "include" | "session" | keyof RequestOptions
>;

/** What an adapter receives, after the `Geocoder` has normalised the caller's options. */
export interface BaseRequest {
  limit?: number;
  language?: string[];
  countries?: string[];
  focus?: LatLon;
  bounds?: BBox;
  types?: PlaceType[];
  session?: string;
  include: Include[];
}

export interface GeocodeRequest extends BaseRequest {
  /** Free text. Exactly one of `query` and `address` is set. */
  query?: string;
  address?: StructuredAddress;
}

export interface ReverseRequest extends BaseRequest {
  point: LatLon;
}

export interface AutocompleteRequest extends BaseRequest {
  query: string;
}

export interface PlacesRequest extends BaseRequest {
  query: string;
}

export interface LookupRequest extends BaseRequest {
  ids: string[];
}

/** The request of each operation. */
export interface Requests {
  geocode: GeocodeRequest;
  reverse: ReverseRequest;
  autocomplete: AutocompleteRequest;
  places: PlacesRequest;
  lookup: LookupRequest;
}

/** One address of a batch. */
export type BatchGeocodeInput =
  | string
  | StructuredAddress
  | {
      id?: string | undefined;
      query?: string | undefined;
      address?: StructuredAddress | undefined;
    };

/** One point of a reverse batch. */
export type BatchReverseInput = LatLon & { id?: string | undefined };

/** Options for a batch. */
export interface BatchOptions<I extends Include = never> extends Omit<SearchOptions<I>, "session"> {
  /** Requests in flight at once, where the batch is emulated or sent in chunks. Default 4. */
  concurrency?: number | undefined;
  /** Milliseconds between status checks of a provider's batch job. Default 1000. */
  pollInterval?: number | undefined;
  /** Called as items finish. */
  onProgress?: ((progress: { done: number; total: number }) => void) | undefined;
}

/** One item's answer. */
export interface BatchItem<I extends Include = never> {
  /** The item's position in the input. */
  index: number;
  /** The item's own `id`, when it had one. */
  id: string | null;
  /** Empty when nothing matched, or when the item failed. */
  results: PlaceWith<I>[];
  /** Why the item failed, else `null`. */
  error: GeocoderError | null;
}

/** A batch's answer, one item per input, in input order. */
export interface BatchResult<I extends Include = never> {
  provider: ProviderId;
  operation: "batch.geocode" | "batch.reverse";
  /** `native` when the provider's own batch endpoint ran it, `emulated` when it ran as single calls. */
  mode: "native" | "emulated";
  items: BatchItem<I>[];
  summary: { total: number; succeeded: number; failed: number };
  attribution: Attribution[];
  unavailable: FieldName[];
  ignored: OptionName[];
}
