/**
 * The requests and responses of Mapbox Geocoding v6 and Search Box v1, as Mapbox documents them.
 * Field names are the wire names. Nothing here is renamed or reshaped.
 */

/** One value or several. Several are sent as one comma-separated value. */
export type List<T> = T | readonly T[];

/** `minLon,minLat,maxLon,maxLat`, as text or as four numbers. It cannot cross the 180th meridian. */
export type BBoxParam = string | readonly [number, number, number, number];

/** `longitude,latitude`, as text or as two numbers. */
export type PointParam = string | readonly [longitude: number, latitude: number];

/** `[minLon, minLat, maxLon, maxLat]`. */
export type BBox = [number, number, number, number];

/** A GeoJSON point. */
export interface PointGeometry {
  /** Always `Point`. */
  type: "Point";
  /** `[longitude, latitude]`. */
  coordinates: [longitude: number, latitude: number];
}

// ---------------------------------------------------------------------------
// Geocoding v6 requests
// ---------------------------------------------------------------------------

/** A feature type of Geocoding v6, largest to smallest. */
export type GeocodingFeatureType =
  | "country"
  | "region"
  | "postcode"
  | "district"
  | "place"
  | "locality"
  | "neighborhood"
  | "street"
  | "block"
  | "address"
  | "secondary_address";

/** A worldview Geocoding v6 can answer from. */
export type Worldview = "ar" | "cn" | "in" | "jp" | "ma" | "rs" | "ru" | "tr" | "us";

/** Whether the answer may be stored. */
export interface GeocodingStorage {
  /**
   * `true` asks for answers that may be stored, which Mapbox bills differently.
   * Without it an answer is for temporary use, and a cache keeps none of it. Default `false`.
   */
  permanent?: boolean | undefined;
}

/** The options a forward query takes, with search text or with structured input. */
export interface GeocodingForwardOptions {
  /** Whether a prefix of a word may match, so that `India` also finds `Indiana`. Default `true`. */
  autocomplete?: boolean | undefined;
  /** Limits results to a box. */
  bbox?: BBoxParam | undefined;
  /** Geocoding v6 GeoJSON output. Default `geojson`. */
  format?: "geojson" | undefined;
  /** IETF language tags, at most 20 and unique. The first is the main one, and the rest add `translations` to the context. */
  language?: List<string> | undefined;
  /** The most results to answer. Default 5, at most 10. */
  limit?: number | undefined;
  /** A point to rank nearby results higher, or `ip` for the caller's own location. */
  proximity?: "ip" | PointParam | undefined;
  /** The feature types to answer. Default all. */
  types?: List<GeocodingFeatureType> | undefined;
  /** The worldview that settles disputed borders. Exactly one. Default `us`. */
  worldview?: Worldview | undefined;
  /** Adds entrances to the `routable_points` of address features. Public preview. Default `false`. */
  entrances?: boolean | undefined;
}

/** A forward query with search text. */
export interface GeocodingTextQuery extends GeocodingForwardOptions {
  /** The text to search, at most 256 characters and 20 words, without a `;`. A `mapbox_id` is also accepted and answers that feature. */
  q: string;
  /** ISO 3166 alpha 2 country codes that limit the results. */
  country?: List<string> | undefined;
}

/** A forward query with structured input, the address given part by part. Mapbox advises `autocomplete: false` with it. */
export interface GeocodingStructuredQuery extends GeocodingForwardOptions {
  /** Structured input has no search text. */
  q?: undefined;
  /** The house number and the street in one string, in place of `address_number` and `street`. */
  address_line1?: string | undefined;
  /** The house number. */
  address_number?: string | undefined;
  /** The street name. */
  street?: string | undefined;
  /** The block, used in Japan. */
  block?: string | undefined;
  /** The city, village or municipality. */
  place?: string | undefined;
  /** The state or province. */
  region?: string | undefined;
  /** The postal code. */
  postcode?: string | undefined;
  /** The official part of a city. */
  locality?: string | undefined;
  /** The colloquial part of a city. */
  neighborhood?: string | undefined;
  /** An ISO 3166-1 code, which limits the results, or a country's full name, which only ranks them. */
  country?: string | undefined;
}

/** A reverse query. */
export interface GeocodingReverseQuery {
  /** Decimal degrees. */
  longitude: number;
  /** Decimal degrees. */
  latitude: number;
  /** ISO 3166 alpha 2 country codes that limit the results. */
  country?: List<string> | undefined;
  /** IETF language tags, at most 20 and unique. The first is the main one, and the rest add `translations` to the context. */
  language?: List<string> | undefined;
  /** The most results to answer. Default 1, at most 5. Any value above 1 needs exactly one value in `types`. */
  limit?: number | undefined;
  /** The feature types to answer. Default all. */
  types?: List<GeocodingFeatureType> | undefined;
  /** The worldview that settles disputed borders. Exactly one. Default `us`. */
  worldview?: Worldview | undefined;
}

/** What `geocoding.forward` takes. Either search text in `q`, or structured input. */
export type GeocodingForwardParams = (GeocodingTextQuery | GeocodingStructuredQuery) &
  GeocodingStorage;

/** What `geocoding.reverse` takes. */
export interface GeocodingReverseParams extends GeocodingReverseQuery, GeocodingStorage {}

/** One query of a batch. Its kind is told by its keys, as on the single endpoints. */
export type GeocodingBatchQuery =
  | GeocodingTextQuery
  | GeocodingStructuredQuery
  | GeocodingReverseQuery;

/** What `geocoding.batch` takes. */
export interface GeocodingBatchParams extends GeocodingStorage {
  /**
   * The queries, sent as the request body, a JSON array.
   * Mapbox documents both 50 and 1000 as the most it accepts in one request.
   */
  queries: readonly GeocodingBatchQuery[];
}

// ---------------------------------------------------------------------------
// Geocoding v6 responses
// ---------------------------------------------------------------------------

/** How precisely a point places an address. The list may grow. */
export type Accuracy =
  | "rooftop"
  | "parcel"
  | "point"
  | "interpolated"
  | "approximate"
  | "intersection"
  // Search Box alone lists this one.
  | "street"
  | (string & {});

/** A layer's name in another language. */
export interface GeocodingTranslation {
  /** The language of `name`. */
  language: string;
  /** The layer's name in that language. */
  name: string;
}

/** The fields every context layer of Geocoding v6 carries. */
export interface GeocodingLayer {
  /** The layer's Mapbox ID. */
  mapbox_id: string;
  /** The layer's name. */
  name: string;
  /** The layer's Wikidata ID, such as `Q61`, when known. */
  wikidata_id?: string;
  /** Another feature that holds the same place. Mapbox shows it on `neighborhood` and `place` and does not define it. */
  alternate?: { mapbox_id: string; name: string };
  /** The name by language, the main one included. Present only when more than one `language` was asked for. */
  translations?: Record<string, GeocodingTranslation>;
}

/** The `address` layer. */
export interface GeocodingAddressLayer extends GeocodingLayer {
  /** The house number. */
  address_number?: string;
  /** The street name. */
  street_name?: string;
}

/** The `secondary_address` layer, a unit within an address. */
export interface GeocodingSecondaryAddressLayer extends GeocodingLayer {
  /** The kind of unit, such as `UNIT`. */
  designator?: string;
  /** The unit's own number or letter, such as `201`. */
  identifier?: string;
  /** `true` when the unit is not in the data and its parent's point stands in for it. */
  extrapolated?: boolean;
}

/** The `region` layer. */
export interface GeocodingRegionLayer extends GeocodingLayer {
  /** The region's short code, such as `DC`. */
  region_code?: string;
  /** The region's ISO 3166-2 code, such as `US-DC`. */
  region_code_full?: string;
}

/** The `country` layer. */
export interface GeocodingCountryLayer extends GeocodingLayer {
  /** The ISO 3166-1 alpha 2 code, in upper case. */
  country_code?: string;
  /** The ISO 3166-1 alpha 3 code. */
  country_code_alpha_3?: string;
}

/** The places a feature lies in, most specific first. A layer without data is absent. */
export interface GeocodingContext {
  /** The address, on address features. */
  address?: GeocodingAddressLayer;
  /** The unit within the address. */
  secondary_address?: GeocodingSecondaryAddressLayer;
  /** The street. */
  street?: GeocodingLayer;
  /** The block, in Japan. */
  block?: GeocodingLayer;
  /** The colloquial part of a city. */
  neighborhood?: GeocodingLayer;
  /** The postal code. */
  postcode?: GeocodingLayer;
  /** The official part of a city. */
  locality?: GeocodingLayer;
  /** The city, village or municipality. */
  place?: GeocodingLayer;
  /** The area between region and city. */
  district?: GeocodingLayer;
  /** The state or province. */
  region?: GeocodingRegionLayer;
  /** The country. */
  country?: GeocodingCountryLayer;
}

/** How one part of the answer compares to the query. `plausible` marks an interpolated house number or an extrapolated unit. */
export type MatchStatus =
  | "matched"
  | "unmatched"
  | "not_applicable"
  | "inferred"
  | "plausible"
  | (string & {});

/** Smart Address Match. How each part of an address feature compares to the query. */
export interface MatchCode {
  /** The house number. */
  address_number?: MatchStatus;
  /** The street. */
  street?: MatchStatus;
  /** The unit. */
  secondary_address?: MatchStatus;
  /** The postal code. */
  postcode?: MatchStatus;
  /** The city. */
  place?: MatchStatus;
  /** The state or province. */
  region?: MatchStatus;
  /** The official part of a city. */
  locality?: MatchStatus;
  /** The country. `inferred` when the query did not name it. */
  country?: MatchStatus;
  /** How well the whole address matches. */
  confidence?: "exact" | "high" | "medium" | "low" | (string & {});
}

/** A point to route to. */
export interface RoutablePoint {
  /** The kind of point. Geocoding names `default` and `entrance`. Search Box shows `POI`, `Address` and `default`. */
  name: string;
  /** Decimal degrees. */
  longitude: number;
  /** Decimal degrees. */
  latitude: number;
  /** A note on the point. Search Box only. */
  note?: string;
}

/** A feature's point, with how precise it is. */
export interface FeatureCoordinates {
  /** Decimal degrees. */
  longitude: number;
  /** Decimal degrees. */
  latitude: number;
  /** How precisely the point places the address. On address features, and on a street that is an intersection. */
  accuracy?: Accuracy;
  /** The points to route to, on address features and POIs. */
  routable_points?: RoutablePoint[];
}

/** The properties of a Geocoding v6 feature. Mapbox may add properties within a version, and never removes one. */
export interface GeocodingProperties {
  /** The feature's ID. Accepted as `q` in a forward query. */
  mapbox_id: string;
  /** The feature's type. */
  feature_type: GeocodingFeatureType | (string & {});
  /** The feature's name. For an address, the house number and the street. */
  name: string;
  /** The canonical name, where `name` is an alias of it. */
  name_preferred?: string;
  /** What follows the name in a full address, such as place, region, postal code and country. */
  place_formatted?: string;
  /** `name_preferred` and `place_formatted` in one string. */
  full_address?: string;
  /** The places the feature lies in. */
  context: GeocodingContext;
  /** The feature's point. */
  coordinates: FeatureCoordinates;
  /** The feature's extent. On `country`, `region`, `postcode`, `district`, `place`, `locality` and `neighborhood` only. */
  bbox?: BBox;
  /** How the feature compares to the query. On address features of a forward query only. */
  match_code?: MatchCode;
  /** How the name is read, by script, such as `ja-Kana` and `ja-Latn`. Japan only. */
  reading?: Record<string, string>;
}

/** A Geocoding v6 feature. */
export interface GeocodingFeature {
  /** Always `Feature`. */
  type: "Feature";
  /** The same value as `properties.mapbox_id`. */
  id: string;
  /** The feature's point. */
  geometry: PointGeometry;
  /** What is known of the feature. */
  properties: GeocodingProperties;
}

/** What `geocoding.forward` and `geocoding.reverse` answer. */
export interface GeocodingResponse {
  /** Always `FeatureCollection`. */
  type: "FeatureCollection";
  /** The results. Forward orders them by relevance, reverse from the most specific to the least. */
  features: GeocodingFeature[];
  /** The notice Mapbox asks to be shown with its data. */
  attribution: string;
}

/** What `geocoding.batch` answers. */
export interface GeocodingBatchResponse {
  /** One answer per query, in the order asked. A query that found nothing has no features. */
  batch: GeocodingResponse[];
}

// ---------------------------------------------------------------------------
// Search Box v1 requests
// ---------------------------------------------------------------------------

/** A feature type of Search Box. Japan has the aliases `prefecture`, `city`, `oaza` and `chome`. */
export type SearchBoxFeatureType =
  | "country"
  | "region"
  | "prefecture"
  | "postcode"
  | "district"
  | "place"
  | "city"
  | "locality"
  | "oaza"
  | "neighborhood"
  | "chome"
  | "block"
  | "street"
  | "address"
  | "poi"
  | "category";

/** How a traveller moves, for an estimated time of arrival. */
export type NavigationProfile = "driving" | "walking" | "cycling";

/** An attribute set `retrieve` can add to `properties.metadata`. `basic` is always included. */
export type AttributeSet = "basic" | "photos" | "visit" | "venue";

/** A price level, cheapest first. */
export type PriceLevel = "$" | "$$" | "$$$" | "$$$$";

/** The options for an estimated time of arrival. */
export interface SearchBoxEtaOptions {
  /** Asks for `eta` on the results. Only `navigation`. Needs `navigation_profile` and either `origin` or `proximity`. */
  eta_type?: "navigation" | undefined;
  /** How the traveller moves. */
  navigation_profile?: NavigationProfile | undefined;
  /** Where the traveller starts. */
  origin?: PointParam | undefined;
}

/** The options `suggest`, `forward` and `category` share. */
export interface SearchBoxSearchOptions extends SearchBoxEtaOptions {
  /** An ISO language code. The first supported one of a list is used. Default `en`. */
  language?: List<string> | undefined;
  /** The most results to answer. At most 10, and 25 for `category`. */
  limit?: number | undefined;
  /** A point to rank nearby results higher, or `ip` for the caller's own location, which is the default. */
  proximity?: "ip" | PointParam | undefined;
  /** A place to search near, as free text or as a point. Once resolved it replaces `proximity`. */
  near?: PointParam | undefined;
  /** Limits results to a box. */
  bbox?: BBoxParam | undefined;
  /** ISO 3166 alpha 2 country codes that limit the results. */
  country?: List<string> | undefined;
  /** The feature types to answer. Default all. */
  types?: List<SearchBoxFeatureType> | undefined;
  /** Canonical category names to leave out. */
  poi_category_exclusions?: List<string> | undefined;
  /** Whether permanently closed POIs are answered too. Default `false`. */
  show_closed_pois?: boolean | undefined;
  /** Degrees around `proximity` to search within, from 0.00001 to 10. Needs `proximity`. */
  radius?: number | undefined;
  /** Turns on search along a route. Only `isochrone`. */
  sar_type?: "isochrone" | undefined;
  /** The route to search along, as an encoded polyline. */
  route?: string | undefined;
  /** The precision of `route`. Default `polyline`. */
  route_geometry?: "polyline" | "polyline6" | undefined;
  /** The longest detour from the route, in minutes. */
  time_deviation?: number | undefined;
}

/** What `searchbox.suggest` takes. */
export interface SearchBoxSuggestParams extends SearchBoxSearchOptions {
  /** The text typed so far, at most 256 characters. */
  q: string;
  /**
   * The session the keystroke belongs to. A UUIDv4 is recommended.
   * Mapbox bills the `suggest` calls and the `retrieve` that ends them as one session.
   */
  session_token: string;
  /** Categories to limit the results to. */
  poi_category?: List<string> | undefined;
}

/** What `searchbox.retrieve` takes. */
export interface SearchBoxRetrieveParams extends SearchBoxEtaOptions {
  /** The `mapbox_id` of a suggestion. It goes in the URL path. */
  id: string;
  /** The session token of the `suggest` calls that led here. */
  session_token: string;
  /** An ISO language code. Default `en`. */
  language?: List<string> | undefined;
  /** The attribute sets to add to `properties.metadata`. Default `basic`. */
  attribute_sets?: List<AttributeSet> | undefined;
  /** The point `distance` and `eta` are measured from. */
  proximity?: PointParam | undefined;
}

/** What `searchbox.forward` takes. */
export interface SearchBoxForwardParams extends SearchBoxSearchOptions {
  /** The text to search, at most 256 characters. */
  q: string;
  /** Categories to limit the results to. */
  poi_category?: List<string> | undefined;
  /** Whether only POIs open now are answered, where their hours are known. */
  open_now?: boolean | undefined;
  /** The lowest rating to answer, from 0.0 to 5.0. */
  minimum_rating?: number | undefined;
  /** The price levels to answer. */
  price_levels?: List<PriceLevel> | undefined;
  /** Parts to leave out of the answer. */
  exclude_fields?: List<"photos" | "reviews"> | undefined;
  /** What orders the results. */
  rank_strategy?: "distance" | "relevance" | undefined;
  /** `true` allows partial and fuzzy matches. */
  auto_complete?: boolean | undefined;
}

/** What `searchbox.category` takes. */
export interface SearchBoxCategoryParams extends SearchBoxSearchOptions {
  /** A canonical category ID from `searchbox.listCategories`, such as `coffee`. It goes in the URL path. */
  canonical_category_id: string;
  /** Parts to leave out of the answer. */
  exclude_fields?: List<"photos" | "reviews"> | undefined;
}

/** What `searchbox.listCategories` takes. */
export interface SearchBoxListCategoriesParams {
  /** An ISO language code for the category names. Default `en`. */
  language?: List<string> | undefined;
}

/** What `searchbox.reverse` takes. */
export interface SearchBoxReverseParams {
  /** Decimal degrees. */
  longitude: number;
  /** Decimal degrees. */
  latitude: number;
  /** An ISO language code. Default `en`. */
  language?: List<string> | undefined;
  /** The most results to answer. At most 10. */
  limit?: number | undefined;
  /** ISO 3166 alpha 2 country codes that limit the results. */
  country?: List<string> | undefined;
  /** The feature types to answer. Default all. `neighborhood` and `chome` are not available here. */
  types?: List<Exclude<SearchBoxFeatureType, "neighborhood" | "chome">> | undefined;
  /** Whether permanently closed POIs are answered too. Default `false`. */
  show_closed_pois?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Search Box v1 responses
// ---------------------------------------------------------------------------

/** The fields every context layer of Search Box may carry. Mapbox sends `id` as text, as an empty string, or not at all. */
export interface SearchBoxLayer {
  /** The layer's ID. */
  id?: string;
  /** The layer's name. */
  name: string;
}

/** The `address` layer. */
export interface SearchBoxAddressLayer extends SearchBoxLayer {
  /** The house number. */
  address_number?: string;
  /** The street name. */
  street_name?: string;
}

/** The `region` layer. */
export interface SearchBoxRegionLayer extends SearchBoxLayer {
  /** The region's short code, such as `MI`. */
  region_code?: string;
  /** The region's ISO 3166-2 code, such as `US-MI`. */
  region_code_full?: string;
}

/** The `country` layer. */
export interface SearchBoxCountryLayer extends SearchBoxLayer {
  /** The ISO 3166-1 alpha 2 code. */
  country_code?: string;
  /** The ISO 3166-1 alpha 3 code. */
  country_code_alpha_3?: string;
}

/** The places a Search Box result lies in. Every layer is optional. */
export interface SearchBoxContext {
  /** The country. */
  country?: SearchBoxCountryLayer;
  /** The state or province. */
  region?: SearchBoxRegionLayer;
  /** The postal code. */
  postcode?: SearchBoxLayer;
  /** The area between region and city. */
  district?: SearchBoxLayer;
  /** The city, village or municipality. */
  place?: SearchBoxLayer;
  /** The official part of a city. */
  locality?: SearchBoxLayer;
  /** The colloquial part of a city. */
  neighborhood?: SearchBoxLayer;
  /** The block, in Japan. */
  block?: SearchBoxLayer;
  /** The address. */
  address?: SearchBoxAddressLayer;
  /** The street. */
  street?: SearchBoxLayer;
}

/** A time of the week. */
export interface OpenHoursTime {
  /** The day of the week, where 0 is Sunday. */
  day: number;
  /** The time of day as `HHMM`. */
  time: string;
}

/** One span of opening hours. */
export interface OpenHoursPeriod {
  /** When the place opens. */
  open: OpenHoursTime;
  /** When the place closes. */
  close?: OpenHoursTime;
}

/** The opening hours of a POI. */
export interface OpenHours {
  /** The spans the place is open in. */
  periods?: OpenHoursPeriod[];
  /** The hours of each day as text, Monday first. */
  weekday_text?: string[];
}

/**
 * More about a POI. Which keys are present depends on the attribute sets asked for and on the data.
 * Mapbox may send keys that are not listed here.
 */
export interface SearchBoxMetadata {
  /** Whether a wheelchair can enter. Set `basic`. */
  wheelchair_accessible?: boolean;
  /** The URL of the main photo. Set `basic`. */
  primary_photo?: string;
  /** The photos. Mapbox does not document an item's shape. Set `photos`. */
  photos?: unknown[];
  /** The Facebook ID. Set `visit`. */
  facebook_id?: string;
  /** The phone number. Set `visit`. */
  phone?: string;
  /** The website. Set `visit`. */
  website?: string;
  /** The fax number. Set `visit`. */
  fax?: string;
  /** The email address. Set `visit`. */
  email?: string;
  /** The Instagram handle. Set `visit`. */
  instagram?: string;
  /** The Twitter handle. Set `visit`. */
  twitter?: string;
  /** The opening hours. Set `visit`. */
  open_hours?: OpenHours;
  /** A longer description. Set `venue`. */
  detailed_description?: string;
  /** The price level. Set `venue`. */
  price_level?: PriceLevel;
  /** The number of reviews. Set `venue`. */
  review_count?: number;
  /** The average rating, from 1 to 5. Set `venue`. */
  rating?: number;
  /** How popular the place is, from 0 to 1. Set `venue`. */
  popularity?: number;
  /** Whether it delivers. Set `venue`. */
  delivery?: boolean;
  /** Whether it has a drive-through. Set `venue`. */
  drive_through?: boolean;
  /** Whether a table can be reserved. Set `venue`. */
  reservable?: boolean;
  /** Whether it has parking. Set `venue`. */
  parking_available?: boolean;
  /** Whether it has valet parking. Set `venue`. */
  valet_parking?: boolean;
  /** Whether there is parking on the street. Set `venue`. */
  street_parking?: boolean;
  /** Whether it serves breakfast. Set `venue`. */
  serves_breakfast?: boolean;
  /** Whether it serves brunch. Set `venue`. */
  serves_brunch?: boolean;
  /** Whether it serves dinner. Set `venue`. */
  serves_dinner?: boolean;
  /** Whether it serves lunch. Set `venue`. */
  serves_lunch?: boolean;
  /** Whether food can be taken away. Set `venue`. */
  takeout?: boolean;
  /** Whether it serves vegan food. Set `venue`. */
  serves_vegan?: boolean;
  /** Whether it serves vegetarian food. Set `venue`. */
  serves_vegetarian?: boolean;
  /** Whether it serves wine. Set `venue`. */
  serves_wine?: boolean;
  /** Whether it serves beer. Set `venue`. */
  serves_beer?: boolean;
  /** How the name is read, with the keys `ja_kana` and `ja_latin`. Japan only. */
  reading?: Record<string, string>;
  [key: string]: unknown;
}

/** What a suggestion and a feature of Search Box both carry. */
export interface SearchBoxCommon {
  /** The result's name. */
  name: string;
  /** The canonical name, only where it differs from `name`. */
  name_preferred?: string;
  /** The name by language code, where the language asked for is not the local one. */
  name_local?: Record<string, string>;
  /** The result's ID. A suggestion's goes to `searchbox.retrieve`. */
  mapbox_id: string;
  /** The result's type, `poi`, `category` or a type of place. */
  feature_type: SearchBoxFeatureType | (string & {});
  /** The house number and the street. */
  address?: string;
  /** `address` and `place_formatted` in one string. */
  full_address?: string;
  /** What follows the name in a full address. A suggestion always has it. */
  place_formatted?: string;
  /** The places the result lies in. */
  context: SearchBoxContext;
  /** The IETF tag of the language the result is in. A suggestion always has it. */
  language?: string;
  /** The name of the Maki icon that fits the result. */
  maki?: string;
  /** The categories of a POI, as names to show. */
  poi_category?: string[];
  /** The categories of a POI, as canonical IDs. */
  poi_category_ids?: string[];
  /** The brands of a POI, as names. */
  brand?: string[];
  /** The brands of a POI, as IDs. */
  brand_id?: string[];
  /** The result's IDs in other sources, by source name. */
  external_ids?: Record<string, string>;
  /** More about a POI. */
  metadata?: SearchBoxMetadata;
  /** Whether a POI is in business, such as `active` or `closed`. */
  operational_status?: "active" | "closed" | (string & {});
  /** Metres from `origin`, or else from `proximity`. */
  distance?: number;
  /** Minutes to get there. Only with `eta_type`, `navigation_profile` and a start point. */
  eta?: number;
}

/** One suggestion. It has no coordinates. `searchbox.retrieve` answers them. */
export interface SearchBoxSuggestion extends SearchBoxCommon {
  /** What follows the name in a full address. */
  place_formatted: string;
  /** The IETF tag of the language the suggestion is in. */
  language: string;
  /** Metres the stop adds to the route, in a search along a route. */
  added_distance?: number;
  /** Minutes the stop adds to the route, in a search along a route. */
  added_time?: number;
}

/** What `searchbox.suggest` answers. */
export interface SearchBoxSuggestResponse {
  /** The suggestions, best first. */
  suggestions: SearchBoxSuggestion[];
  /** The notice Mapbox asks to be shown with its data. */
  attribution: string;
  /** The ID of this response. */
  response_id?: string;
}

/** The properties of a Search Box feature. */
export interface SearchBoxProperties extends SearchBoxCommon {
  /** The feature's point. */
  coordinates: FeatureCoordinates;
  /** The feature's extent. */
  bbox?: BBox;
}

/** A Search Box feature. Unlike a Geocoding feature it has no `id` of its own. */
export interface SearchBoxFeature {
  /** Always `Feature`. */
  type: "Feature";
  /** The feature's point. */
  geometry: PointGeometry;
  /** What is known of the feature. */
  properties: SearchBoxProperties;
}

/** What `searchbox.retrieve`, `searchbox.forward`, `searchbox.category` and `searchbox.reverse` answer. */
export interface SearchBoxResponse {
  /** Always `FeatureCollection`. */
  type: "FeatureCollection";
  /** The results. */
  features: SearchBoxFeature[];
  /** The notice Mapbox asks to be shown with its data. */
  attribution: string;
  /** The ID of this response. */
  response_id?: string;
}

/** One category of the list. */
export interface SearchBoxCategory {
  /** The ID `searchbox.category` takes. */
  canonical_id: string;
  /** The name of the Maki icon that fits the category. */
  icon: string;
  /** The category's name, in the language asked for. */
  name: string;
  /** An internal version. It is not stable. */
  version: string;
  /** An ID that changes between requests. */
  uuid: string;
}

/** What `searchbox.listCategories` answers. */
export interface SearchBoxListCategoriesResponse {
  /** The categories. Mapbox spells the key in camel case. */
  listItems: SearchBoxCategory[];
  /** The notice Mapbox asks to be shown with its data. */
  attribution: string;
  /** The version of the service. */
  version: string;
}

/** The body Mapbox sends with an error. */
export interface MapboxErrorBody {
  /** What went wrong. */
  message: string;
}
