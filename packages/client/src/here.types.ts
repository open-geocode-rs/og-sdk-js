/**
 * The requests and responses of HERE Geocoding and Search v7 and HERE Batch API v7, as HERE names them.
 * Nothing here is translated. A field HERE leaves out of an answer is absent, never `null`.
 */

/**
 * A value from a list HERE says it may add to without notice.
 * The known values autocomplete, and any other string is still accepted.
 */
export type Open<T extends string> = T | (string & {});

// Request parameters

/**
 * A qualified query, sent as `qq`. Each part narrows the match to one address field.
 * It is written on the wire as `city=Berlin;country=Germany`.
 */
export interface QualifiedQuery {
  /** The country, by name or code. */
  country?: string | undefined;
  /** The state or province. */
  state?: string | undefined;
  /** The county. */
  county?: string | undefined;
  /** The city. */
  city?: string | undefined;
  /** The district of a city. */
  district?: string | undefined;
  /** The street name. */
  street?: string | undefined;
  /** The house number. */
  houseNumber?: string | undefined;
  /** The postal code. */
  postalCode?: string | undefined;
}

/** Which variant of a component's name an answer uses. It is sent as `addressNamesVariant[city]=administrative`. */
export interface AddressNamesVariant {
  /** `administrative` gives the administrative name of the city. HERE supports it in the USA only. */
  city?: "administrative" | undefined;
}

/** A payment method an EV station may accept. */
export type EvPaymentMethodId =
  | "authByCarPlugAndCharge"
  | "creditCard"
  | "debitCard"
  | "onlineApplePay"
  | "onlineGooglePay"
  | "onlinePaypal"
  | "operatorApp";

/** Constraints on EV station results. Each one is sent as `evStation[<property>]`. */
export interface EvStationFilter {
  /** The least power in kW that at least one EVSE of the station delivers. */
  minPower?: number | undefined;
  /** The most power in kW that at least one EVSE of the station delivers. */
  maxPower?: number | undefined;
  /** Connector type IDs. At least one EVSE of the station has one of them. */
  connectorTypeIds?: readonly (number | string)[] | undefined;
  /** Names of charge point operators. */
  supplierNames?: readonly string[] | undefined;
  /** The current at one of the station's EVSE. */
  current?: "AC" | "DC" | undefined;
  /** Partner IDs of e-Mobility Service Providers available at the station. */
  eMobilityServiceProviderPartnerIds?: readonly string[] | undefined;
  /** Payment methods the station supports. */
  paymentMethodIds?: readonly EvPaymentMethodId[] | undefined;
}

/** A car fuel type. */
export type CarFuelType =
  | "biodiesel"
  | "cng"
  | "diesel"
  | "diesel_with_additives"
  | "e10"
  | "e20"
  | "e85"
  | "ethanol"
  | "ethanol_with_additives"
  | "gasohol_95"
  | "gasoline"
  | "hvo"
  | "hydrogen"
  | "lng"
  | "lpg"
  | "midgrade"
  | "octane_100"
  | "octane_87"
  | "octane_89"
  | "octane_90"
  | "octane_91"
  | "octane_92"
  | "octane_93"
  | "octane_95"
  | "octane_98"
  | "premium"
  | "premium_with_additives"
  | "regular"
  | "regular_with_additives";

/** A truck fuel type. */
export type TruckFuelType = "truck_cng" | "truck_diesel" | "truck_hydrogen" | "truck_lng";

/** The truck classes a fuel station serves. `heavy` includes medium trucks. */
export type TruckClass = "heavy" | "medium";

/** Constraints on fuel station results (BETA). Each one is sent as `fuelStation[<property>]`. */
export interface FuelStationFilter {
  /** Fuel types. A station that serves at least one of them matches (RESTRICTED). */
  fuelTypes?: readonly Open<CarFuelType | TruckFuelType>[] | undefined;
  /** The least truck class the station's truck fuel serves (RESTRICTED). */
  minimumTruckClass?: TruckClass | undefined;
}

/** A value of `showLocalizedNames` (ALPHA). `ja-Hira` is Japanese Hiragana. */
export type ShowLocalizedNames = "ja-Hira";

/** A value of `showNavAttributes`. `speedLimits` is priced as a premium feature. */
export type ShowNavAttributes = "access" | "functionalClass" | "physical" | "speedLimits";

/** A value of `showMapReferences` on geocode, reverse geocode and lookup. */
export type ShowMapReferences =
  | "adminIds"
  | "cmVersion"
  | "links"
  | "microPointAddress"
  | "pointAddress"
  | "segments";

/** A value of `show` on discover and browse. */
export type ShowPlaces =
  | "eMobilityServiceProviders"
  | "ev"
  | "fuel"
  | "fuelPrices"
  | "phonemes"
  | "referenceCategories"
  | "streetInfo"
  | "tripadvisor"
  | "tripadvisorImageVariants"
  | "truck"
  | "tz";

/** A value of `mobilityMode`. */
export type MobilityMode = "car" | "motorbike" | "truck";

/** Parameters of `GET /v1/geocode`. One of `q` and `qq` is required, and both may be sent. */
export interface GeocodeParams {
  /** A free-text query, such as `Invalidenstraße 116 Berlin`. */
  q?: string | undefined;
  /** A qualified query, as HERE's own string `city=Berlin;country=Germany` or as an object. */
  qq?: string | QualifiedQuery | undefined;
  /** The centre of the search context, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /** A hard filter by country, as `countryCode:CAN,MEX,USA` with upper-case ISO 3166-1 alpha-3 codes. */
  in?: string | undefined;
  /** Whether address fields carry the names matched by the query or the normalized ones. */
  addressNamesMode?: "matched" | "normalized" | undefined;
  /** Which variant of a component's name to return. It wins over `addressNamesMode`. */
  addressNamesVariant?: AddressNamesVariant | undefined;
  /** Returns one result per city or district for a postal code that spans several. */
  postalCodeMode?: "cityLookup" | "districtLookup" | undefined;
  /** The types of result to return. Without it all types are considered. */
  types?:
    | readonly ("address" | "area" | "city" | "houseNumber" | "place" | "postalCode" | "street")[]
    | undefined;
  /** Features that are off by default. `MPA` returns Micro Point Addresses (RESTRICTED). */
  with?: readonly "MPA"[] | undefined;
  /** BCP 47 language codes for the answer, in order of preference. */
  lang?: readonly string[] | undefined;
  /** The most results to return. From 1 to 100, default 20. */
  limit?: number | undefined;
  /** An upper-case ISO 3166-1 alpha-3 country code whose view of disputed borders applies. */
  politicalView?: string | undefined;
  /** Extra sections to render in each item. */
  show?:
    | readonly (
        | "addressUsage"
        | "countryInfo"
        | "parsing"
        | "postalCodeDetails"
        | "secondaryUnitInfo"
        | "streetInfo"
        | "tz"
      )[]
    | undefined;
  /** An extra display language for every name field, returned in `localizedNames` (ALPHA). */
  showLocalizedNames?: readonly ShowLocalizedNames[] | undefined;
  /** The map references to return in `mapReferences`. */
  showMapReferences?: readonly ShowMapReferences[] | undefined;
  /** The road attributes to return in `navigationAttributes`. */
  showNavAttributes?: readonly ShowNavAttributes[] | undefined;
  /** The related items to return in `related`. */
  showRelated?: readonly ("MPA" | "intersections" | "parentPA")[] | undefined;
  /** The address fields to return every translation and alternative name of. */
  showTranslations?: readonly ("city" | "county" | "district" | "state")[] | undefined;
}

/** The parameters `/v1/revgeocode` and `/v1/multi-revgeocode` share. */
export interface ReverseGeocodeOptions {
  /** Which variant of a component's name to return. */
  addressNamesVariant?: AddressNamesVariant | undefined;
  /** The types of result to return. With `bearing`, only `street` is accepted. */
  types?: readonly ("address" | "area" | "city" | "houseNumber" | "place" | "street")[] | undefined;
  /** Features that are off by default. */
  with?: readonly ("MPA" | "estimatedAreaFallback" | "unnamedStreets")[] | undefined;
  /** BCP 47 language codes for the answer, in order of preference. */
  lang?: readonly string[] | undefined;
  /** The most results to return. From 1 to 100 with default 1, and at most 10 on multi reverse geocode. */
  limit?: number | undefined;
  /** An upper-case ISO 3166-1 alpha-3 country code whose view of disputed borders applies. */
  politicalView?: string | undefined;
  /** An extra display language for every name field, returned in `localizedNames` (ALPHA). */
  showLocalizedNames?: readonly ShowLocalizedNames[] | undefined;
  /** The map references to return in `mapReferences`. */
  showMapReferences?: readonly ShowMapReferences[] | undefined;
  /** The road attributes to return in `navigationAttributes`. */
  showNavAttributes?: readonly ShowNavAttributes[] | undefined;
  /** The related items to return in `related`. */
  showRelated?: readonly ("intersections" | "nearbyAddress" | "parentPA")[] | undefined;
  /** Extra sections to render in each item. */
  show?:
    | readonly ("addressUsage" | "countryInfo" | "postalCodeDetails" | "streetInfo" | "tz")[]
    | undefined;
}

/** Parameters of `GET /v1/revgeocode`. Exactly one of `at` and `in` is required. */
export interface RevgeocodeParams extends ReverseGeocodeOptions {
  /** The point to look up, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /** A circle to search within, as `circle:{latitude},{longitude};r={radius in metres}`. */
  in?: string | undefined;
  /** The heading in degrees clockwise from north, 0 to 359. With it every result is a street. */
  bearing?: number | undefined;
}

/** One sub-request of a multi reverse geocode call. Exactly one of `at` and `in` is required. */
export interface MultiRevgeocodeQuery {
  /** The caller's name for the sub-request. Unique in the call, at most 64 characters of `[A-Za-z0-9_-]`. */
  id: string;
  /** The point to look up, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /** A circle to search within, as `circle:{latitude},{longitude};r={radius in metres}`. */
  in?: string | undefined;
  /** The heading in degrees clockwise from north, 0 to 359. */
  bearing?: number | undefined;
}

/** Parameters of `POST /v1/multi-revgeocode`. The shared parameters apply to every sub-request. */
export interface MultiRevgeocodeParams extends ReverseGeocodeOptions {
  /**
   * The request body. Either the sub-requests, at most 100, which are written one per line,
   * or the body text itself, one line such as `id=1&at=50.11059,8.68407` per sub-request.
   */
  body: readonly MultiRevgeocodeQuery[] | string;
}

/** The parameters of autosuggest, discover and browse that filter and page places. */
export interface PlaceSearchOptions {
  /** Constraints on fuel station results (BETA). */
  fuelStation?: FuelStationFilter | undefined;
  /** Constraints on EV station results. */
  evStation?: EvStationFilter | undefined;
  /** Ranks results along `route` by distance from it (BETA). It needs `route`. */
  ranking?: "excursionDistance" | undefined;
  /**
   * A corridor to search within (BETA), as a flexible polyline with an optional width in metres,
   * such as `BFoz5xJ67i1B1B7PzIhaxL7Y;w=5000`. The client sends it in the body of a POST.
   */
  route?: string | undefined;
  /** BCP 47 language codes for the answer, in order of preference. */
  lang?: readonly string[] | undefined;
  /** The most results to return, or the page size with `offset`. From 1 to 100, default 20. */
  limit?: number | undefined;
  /** Switches paging on (ALPHA). The answer then carries `offset`, `nextOffset`, `count` and `limit`. From 0 to 99. */
  offset?: number | undefined;
  /** An upper-case ISO 3166-1 alpha-3 country code whose view of disputed borders applies. */
  politicalView?: string | undefined;
  /** An extra display language for every name field, returned in `localizedNames` (ALPHA). */
  showLocalizedNames?: readonly ShowLocalizedNames[] | undefined;
}

/** Parameters of `/v1/autosuggest`. One of `at`, `in=circle` and `in=bbox` is required. */
export interface AutosuggestParams extends PlaceSearchOptions {
  /** The free text typed so far. */
  q: string;
  /** The centre of the search context, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /**
   * A hard filter by area. `countryCode:USA,CAN`, `circle:{lat},{lng};r={metres}`
   * or `bbox:{west},{south},{east},{north}`.
   */
  in?: string | undefined;
  /** How the end user travels, which ranks results that suit the vehicle first. */
  mobilityMode?: MobilityMode | undefined;
  /** The most query term suggestions to return in `queryTerms`. From 0 to 10. */
  termsLimit?: number | undefined;
  /** Features that are off by default. `recommendPlaces` ranks some categories by prominence (ALPHA, RESTRICTED). */
  with?: readonly "recommendPlaces"[] | undefined;
  /** Extra sections to render in each item. */
  show?:
    | readonly (
        | "details"
        | "fuel"
        | "phonemes"
        | "referenceCategories"
        | "streetInfo"
        | "truck"
        | "tz"
      )[]
    | undefined;
  /** The map references to return in `mapReferences`. */
  showMapReferences?: readonly ("adminIds" | "pointAddress" | "segments")[] | undefined;
}

/** Parameters of `GET /v1/autocomplete`. */
export interface AutocompleteParams {
  /** The free text typed so far. */
  q: string;
  /** The centre of the search context, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /**
   * A hard filter by area. `countryCode:USA,CAN`, `circle:{lat},{lng};r={metres}`
   * or `bbox:{west},{south},{east},{north}`.
   */
  in?: string | undefined;
  /** Returns one result per city or district for a postal code that spans several. */
  postalCodeMode?: "cityLookup" | "districtLookup" | undefined;
  /** The types of result to return. */
  types?:
    | readonly ("address" | "area" | "city" | "houseNumber" | "postalCode" | "street")[]
    | undefined;
  /** Features that are off by default. `MPA` returns Micro Point Addresses (RESTRICTED). */
  with?: readonly "MPA"[] | undefined;
  /** The preferred BCP 47 languages. They apply to the parts of an address the query did not match. */
  lang?: readonly string[] | undefined;
  /** The most results to return. From 1 to 20, default 5. */
  limit?: number | undefined;
  /** An upper-case ISO 3166-1 alpha-3 country code whose view of disputed borders applies. */
  politicalView?: string | undefined;
  /** Extra sections to render in each item. */
  show?: readonly ("hasRelatedMPA" | "streetInfo")[] | undefined;
  /** An extra display language for every name field, returned in `localizedNames` (ALPHA). */
  showLocalizedNames?: readonly ShowLocalizedNames[] | undefined;
}

/** Parameters of `/v1/discover`. One of `at`, `in=circle` and `in=bbox` is required. */
export interface DiscoverParams extends PlaceSearchOptions {
  /** A free-text query for an address or a place. */
  q: string;
  /** The centre of the search context, as `{latitude},{longitude}`. */
  at?: string | undefined;
  /**
   * A hard filter by area. `countryCode:USA,CAN`, `circle:{lat},{lng};r={metres}`
   * or `bbox:{west},{south},{east},{north}`.
   */
  in?: string | undefined;
  /** How the end user travels, which ranks results that suit the vehicle first. */
  mobilityMode?: MobilityMode | undefined;
  /** Features that are off by default. `recommendPlaces` ranks some categories by prominence (ALPHA, RESTRICTED). */
  with?: readonly "recommendPlaces"[] | undefined;
  /** Extra sections to render in each item. */
  show?: readonly ShowPlaces[] | undefined;
}

/** Parameters of `/v1/browse`. */
export interface BrowseParams extends PlaceSearchOptions {
  /** The centre results are ranked by distance from, as `{latitude},{longitude}`. */
  at: string;
  /** Category IDs of the HERE Places Category System. A leading `!` excludes a category. */
  categories?: readonly string[] | undefined;
  /** Chain IDs of the HERE Places Chain System. A leading `!` excludes a chain. */
  chains?: readonly string[] | undefined;
  /** Cuisine IDs of the HERE Places Cuisine System. A leading `!` excludes a food type. */
  foodTypes?: readonly string[] | undefined;
  /**
   * A hard filter by area. `countryCode:USA,CAN`, `circle:{lat},{lng};r={metres}`
   * or `bbox:{west},{south},{east},{north}`.
   */
  in?: string | undefined;
  /** A full-text filter on place names. A partial match is enough. */
  name?: string | undefined;
  /** Extra sections to render in each item. */
  show?: readonly ShowPlaces[] | undefined;
}

/** Parameters of `GET /v1/lookup`. */
export interface LookupParams {
  /** The `id` of a result item from another endpoint. */
  id: string;
  /** Which variant of a component's name to return. */
  addressNamesVariant?: AddressNamesVariant | undefined;
  /** BCP 47 language codes for the answer, in order of preference. */
  lang?: readonly string[] | undefined;
  /** An upper-case ISO 3166-1 alpha-3 country code whose view of disputed borders applies. */
  politicalView?: string | undefined;
  /** An extra display language for every name field, returned in `localizedNames` (ALPHA). */
  showLocalizedNames?: readonly ShowLocalizedNames[] | undefined;
  /** Extra sections to render in the item. */
  show?: readonly (ShowPlaces | "addressUsage" | "countryInfo" | "postalCodeDetails")[] | undefined;
  /** The map references to return in `mapReferences`. */
  showMapReferences?: readonly ShowMapReferences[] | undefined;
  /** The road attributes to return in `navigationAttributes`. */
  showNavAttributes?: readonly ShowNavAttributes[] | undefined;
  /** The related items to return in `related`. */
  showRelated?: readonly ("MPA" | "parentPA")[] | undefined;
}

// Response fields

/** The type of a result item. HERE may add values without notice. */
export type ResultType = Open<
  | "addressBlock"
  | "administrativeArea"
  | "houseNumber"
  | "intersection"
  | "locality"
  | "place"
  | "postalCodePoint"
  | "street"
>;

/** How a house number was located. `PA` is a point address, `MPA` a micro point address (RESTRICTED). */
export type HouseNumberType = Open<"MPA" | "PA" | "interpolated">;

/** The kind of an `addressBlock` result. */
export type AddressBlockType = Open<"block" | "subblock">;

/** The kind of a `locality` result. */
export type LocalityType = Open<"city" | "district" | "postalCode" | "subdistrict">;

/** The kind of an `administrativeArea` result. */
export type AdministrativeAreaType = Open<"country" | "county" | "state">;

/** Whether an address is residential (ALPHA, RESTRICTED). Rendered with `show=addressUsage`. */
export interface AddressUsage {
  /** Whether the address is residential. */
  usageType: Open<"nonResidential" | "residential">;
}

/** The postal address of a reverse geocode result. */
export interface RgcAddress {
  /** The address assembled by the postal rules of its region. */
  label?: string;
  /** The ISO 3166-1 alpha-3 country code, such as `DEU`. */
  countryCode?: string;
  /** The localized country name. */
  countryName?: string;
  /** The state code or abbreviation, such as `CA`. */
  stateCode?: string;
  /** The state. */
  state?: string;
  /** The county code or abbreviation. */
  countyCode?: string;
  /** The county, a division of a state. */
  county?: string;
  /** The primary locality of the place. */
  city?: string;
  /** The localized postal city or town, where a country defines them. */
  postalCity?: string;
  /** A division of a city. */
  district?: string;
  /** A subdivision of a district. */
  subdistrict?: string;
  /** The street name. */
  street?: string;
  /** The block name. */
  block?: string;
  /** The sub-block name. */
  subblock?: string;
  /** The postal code. */
  postalCode?: string;
  /** The house number. */
  houseNumber?: string;
  /** The building name. */
  building?: string;
  /** The secondary unit, such as a building, floor or suite. */
  unit?: string;
}

/** The postal address of a result item. */
export interface Address extends RgcAddress {
  /** The street names of an intersection result. */
  streets?: string[];
}

/** The address of a related item. Only the fields that differ from the main item are rendered. */
export type RelatedResultAddress = Address;

/** A name in one language. */
export interface LocalizedName {
  /** The text of the name. */
  value: string;
  /** The BCP 47 language code. */
  language: string;
}

/** The names of an item in the language asked for with `showLocalizedNames`. */
export interface LocalizedNames {
  /** The place name. */
  placeNames?: LocalizedName[];
  /** The country name. */
  countryNames?: LocalizedName[];
  /** The state name. */
  stateNames?: LocalizedName[];
  /** The county name. */
  countyNames?: LocalizedName[];
  /** The city name. */
  cityNames?: LocalizedName[];
  /** The district name. */
  districtNames?: LocalizedName[];
  /** The subdistrict name. */
  subdistrictNames?: LocalizedName[];
  /** The street name. */
  streetNames?: LocalizedName[];
  /** The block name. */
  blockNames?: LocalizedName[];
  /** The subblock name. */
  subblockNames?: LocalizedName[];
  /** The house number. */
  houseNumberNames?: LocalizedName[];
}

/** Details of a Japan Post business postal code (ALPHA). */
export interface PostalCodeDetailsJapanPost {
  /** The 7-digit business postal code, as `XXX-XXXX`. */
  postalCode: string;
  /** The postal entity, always `Japan Post`. */
  postalEntity?: "Japan Post";
  /** The postal code type, always `ZIP`. */
  postalCodeType?: "ZIP";
  /** The company, building or floor the postal code is assigned to. */
  businessName?: string;
}

/** Details of a USPS ZIP code. */
export interface PostalCodeDetailsUspsZip {
  /** The postal code. */
  postalCode: string;
  /** The postal entity. */
  postalEntity?: "USPS";
  /** The postal code type. */
  postalCodeType?: "ZIP";
  /** `M` is military, `P` is post office boxes only, `U` is a ZIP of one organisation. */
  zipClassificationCode?: Open<"M" | "P" | "U">;
}

/** Details of a USPS ZIP+4 code. */
export interface PostalCodeDetailsUspsZipPlus4 {
  /** The postal code. */
  postalCode: string;
  /** The postal entity. */
  postalEntity?: "USPS";
  /** The postal code type. */
  postalCodeType?: "ZIP+4";
  /** `F` firm, `G` general delivery, `H` high-rise, `P` PO box, `R` rural route, `S` street. */
  recordTypeCode?: Open<"F" | "G" | "H" | "P" | "R" | "S">;
}

/** Details of a `postalCodePoint` result, rendered with `show=postalCodeDetails`. */
export type PostalCodeDetails =
  | PostalCodeDetailsJapanPost
  | PostalCodeDetailsUspsZip
  | PostalCodeDetailsUspsZipPlus4;

/** A point, as the coordinates of a pin on a map. */
export interface DisplayResponseCoordinate {
  /** The latitude. */
  lat: number;
  /** The longitude. */
  lng: number;
}

/** A point on a navigable link, for driving or walking to the item. */
export interface BasicAccessPoint {
  /** The latitude. */
  lat: number;
  /** The longitude. */
  lng: number;
}

/** An access point of a place, which may be one of several. */
export interface ExtendedAccessPoint extends BasicAccessPoint {
  /** `true` on the primary access point of a place that has several. Only the first can have it. */
  primary?: boolean;
  /** What the access point is for. */
  type?: Open<"delivery" | "emergency" | "entrance" | "loading" | "other" | "parking" | "taxi">;
  /** A short description, such as `North Entrance`. */
  label?: string;
}

/** The bounding box of the area or line a result covers. */
export interface MapView {
  /** The longitude of the western side. */
  west: number;
  /** The latitude of the southern side. */
  south: number;
  /** The longitude of the eastern side. */
  east: number;
  /** The latitude of the northern side. */
  north: number;
}

/** A category or food type of a place. */
export interface Category {
  /** The category ID, such as `600-6600-0082`. */
  id: string;
  /** The category name in the language of the item. */
  name?: string;
  /** Present, and `true`, on a primary category only. */
  primary?: boolean;
}

/** A reference to a category by its ID. */
export interface CategoryRef {
  /** The category ID, such as `600-6600-0082`. */
  id: string;
}

/** A chain a place belongs to. */
export interface Chain {
  /** The chain ID, such as `1396`. */
  id: string;
  /** The chain name in the language of the item. */
  name?: string;
}

/** The time zone of a place, rendered with `show=tz`. */
export interface TimeZoneInfo {
  /** The tz database name, such as `Europe/Berlin`. */
  name: string;
  /** The UTC offset at request time, such as `+02:00`. */
  utcOffset: string;
}

/** How well each field of a result matches its part of the query. Every score is from 0 to 1. */
export interface FieldScore {
  /** The country name or code. */
  country?: number;
  /** The country code. */
  countryCode?: number;
  /** The state name. */
  state?: number;
  /** The state code. */
  stateCode?: number;
  /** The county name. */
  county?: number;
  /** The county code. */
  countyCode?: number;
  /** The city name. */
  city?: number;
  /** The district name. */
  district?: number;
  /** The subdistrict name. */
  subdistrict?: number;
  /** The street names, one score per street in the query. */
  streets?: number[];
  /** The block name. */
  block?: number;
  /** The sub-block name. */
  subblock?: number;
  /** The house number. It is below 1 when the nearest known house number was returned. */
  houseNumber?: number;
  /** The postal code. */
  postalCode?: number;
  /** The building name. */
  building?: number;
  /** Whether a secondary unit was recognized in the query. */
  unit?: number;
  /** The place name. */
  placeName?: number;
  /** The ontology name. */
  ontologyName?: number;
}

/** How well a geocode result matches the query. */
export interface Scoring {
  /** How well the input matches the returned address. It is 1 when every input token matched. */
  queryScore?: number;
  /** The score of each result field that matched the query. */
  fieldScore?: FieldScore;
}

/** One term of the query and the field it was read as. */
export interface MatchInfo {
  /** The first index of the term in the query, inclusive. */
  start: number;
  /** One past the last index of the term in the query. */
  end: number;
  /** The term as it stands in the query. */
  value: string;
  /** The qualified query field the term came from. Absent for a term of the free-text query. */
  qq?: Open<
    "city" | "country" | "county" | "district" | "houseNumber" | "postalCode" | "state" | "street"
  >;
}

/** How the query was read, rendered with `show=parsing`. */
export interface Parsing {
  /** Place name matches. */
  placeName?: MatchInfo[];
  /** Country matches. */
  country?: MatchInfo[];
  /** State matches. */
  state?: MatchInfo[];
  /** County matches. */
  county?: MatchInfo[];
  /** City matches. */
  city?: MatchInfo[];
  /** District matches. */
  district?: MatchInfo[];
  /** Subdistrict matches. */
  subdistrict?: MatchInfo[];
  /** Street matches. */
  street?: MatchInfo[];
  /** Block matches. */
  block?: MatchInfo[];
  /** Subblock matches. */
  subblock?: MatchInfo[];
  /** House number matches. */
  houseNumber?: MatchInfo[];
  /** Postal code matches. */
  postalCode?: MatchInfo[];
  /** Building matches. */
  building?: MatchInfo[];
  /** Secondary unit matches. */
  secondaryUnits?: MatchInfo[];
  /** Terms that match no address component in the map data. */
  additionalInfo?: MatchInfo[];
}

/** A street name split into its parts, rendered with `show=streetInfo`. */
export interface StreetInfo {
  /** The base name of the street. */
  baseName?: string;
  /** The street type, such as `Street` or `Avenue`. */
  streetType?: string;
  /** Whether the street type comes before the base name. */
  streetTypePrecedes?: boolean;
  /** Whether the street type is attached to the base name. */
  streetTypeAttached?: boolean;
  /** A directional identifier before the base name. */
  prefix?: string;
  /** A directional identifier after the base name. */
  suffix?: string;
  /** The official direction of a highway, such as `North/South`. */
  direction?: string;
  /** The BCP 47 language code. */
  language?: string;
}

/** The codes of the country, rendered with `show=countryInfo`. */
export interface CountryInfo {
  /** The ISO 3166-1 alpha-2 country code. */
  alpha2?: string;
  /** The ISO 3166-1 alpha-3 country code. */
  alpha3?: string;
}

/** One name of an address field. */
export interface Name {
  /** The text of the name. */
  value: string;
  /** The BCP 47 language code. */
  language?: string;
  /** The kind of name. */
  type: Open<"abbreviation" | "areaCode" | "baseName" | "exonym" | "shortened" | "synonym">;
  /** Present, and `true`, on the name a result shows by default. */
  primary?: boolean;
  /** Present, and `true`, on a transliterated name. */
  transliterated?: boolean;
}

/** The names of an address field from one view of it, such as the administrative or the postal one. */
export interface AdminNames {
  /** Every value of the name, by language and kind. */
  names: Name[];
  /** Whether this is the default view of the field or an alternative one. */
  preference?: Open<"alternative" | "primary">;
}

/** Every translation and alternative name of the fields asked for with `showTranslations`. */
export interface Translations {
  /** The state names. */
  stateNames?: AdminNames[];
  /** The county names. */
  countyNames?: AdminNames[];
  /** The city names. */
  cityNames?: AdminNames[];
  /** The district names. */
  districtNames?: AdminNames[];
}

/** A link of the HERE core map and the side of it an item is on. */
export interface LinkInfoSection {
  /** The link ID in the HERE core map. */
  cmId: string;
  /** The side of the link the item is on. */
  side: string;
}

/** A reference to a point address in HERE Map Content. */
export interface PointAddressSection {
  /** The point address ID. */
  hmcId: string;
  /** The partition of HERE Map Content the ID is in (ALPHA). */
  partitionId?: string;
}

/** A reference to a micro point address in HERE Map Content. */
export interface MicroPointAddressSection {
  /** The micro point address ID. */
  hmcId: string;
  /** The partition of HERE Map Content the ID is in (ALPHA). */
  partitionId?: string;
}

/** A reference to a street segment. */
export interface Segment {
  /** The segment, as `{segmentId}(#{offset})?`. */
  ref?: string;
  /** The side of the segment the item is on. */
  side?: string;
}

/** A reference to an administrative area in HERE Map Content. */
export interface AdminIdSection {
  /** The admin ID. */
  hmcId: string;
  /** The partition of HERE Map Content the ID is in (ALPHA). */
  partitionId?: string;
}

/** The version of the core map in the region of a result. */
export interface CmVersionSection {
  /** The region ID. */
  region: string;
  /** The map version (DVN), such as `23150`. */
  dvn: string;
}

/** The map references of an autosuggest item, rendered with `showMapReferences`. */
export interface MapReferenceSectionAS {
  /** The point address reference. */
  pointAddress?: PointAddressSection;
  /** The segment references. */
  segments?: Segment[];
  /** The country ID in HERE Map Content. */
  country?: AdminIdSection;
  /** The state ID in HERE Map Content. */
  state?: AdminIdSection;
  /** The county ID in HERE Map Content. */
  county?: AdminIdSection;
  /** The city ID in HERE Map Content. */
  city?: AdminIdSection;
  /** The district ID in HERE Map Content. */
  district?: AdminIdSection;
  /** The subdistrict ID in HERE Map Content. */
  subdistrict?: AdminIdSection;
}

/** The map references of an item, rendered with `showMapReferences`. */
export interface MapReferenceSection extends MapReferenceSectionAS {
  /** The links at the access position of the item. */
  links?: LinkInfoSection[];
  /** The micro point address reference (RESTRICTED). Geocode and lookup only. */
  microPointAddress?: MicroPointAddressSection;
  /** The core map version of the region. */
  cmVersion?: CmVersionSection;
}

/** An item related to a result, rendered with `showRelated`. */
export interface RelatedAddress {
  /** How the item relates to the result. */
  relationship: Open<"MPA" | "intersection" | "nearbyAddress" | "parentPA">;
  /** The localized display name. */
  title?: string;
  /** The ID of the related item. */
  id: string;
  /** The result type of the related item. */
  resultType?: ResultType;
  /** The house number type of the related item. */
  houseNumberType?: HouseNumberType;
  /** The address of the related item. Only the fields that differ from the result are rendered. */
  address?: RelatedResultAddress;
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links. */
  access?: BasicAccessPoint[];
  /** Metres from the search centre, as the crow flies. Reverse geocode only. */
  distance?: number;
  /** Metres along the road from the nearby address to the street result. Reverse geocode only. */
  routeDistance?: number;
  /** Degrees clockwise from north, from the point on the street to the related item. Reverse geocode only. */
  bearing?: number;
  /** The bounding box of the related item. Reverse geocode only. */
  mapView?: MapView;
  /** The map references of the related item. Reverse geocode only. */
  mapReferences?: MapReferenceSection;
}

/** The speed limit of a road in one direction of travel. */
export interface SpeedLimit {
  /** The speed limit in `speedUnit`. `999` means there is none. */
  maxSpeed: number;
  /** The compass direction of travel. */
  direction?: Open<"E" | "N" | "NE" | "NW" | "S" | "SE" | "SW" | "W">;
  /** The unit the country uses. */
  speedUnit: Open<"kph" | "mph">;
  /** Whether the limit is posted on a sign or derived from regulations. */
  source?: Open<"derived" | "posted">;
}

/** The functional class of a road, from `1` for the fastest, highest volume roads to `5` for the smallest. */
export interface FunctionalClass {
  /** The class. */
  value: Open<"1" | "2" | "3" | "4" | "5">;
}

/** Which vehicles and travellers a road allows. */
export interface Access {
  /** Automobiles. */
  automobiles?: boolean;
  /** Bicycles. */
  bicycles?: boolean;
  /** Buses. */
  buses?: boolean;
  /** Carpools. */
  carpools?: boolean;
  /** Deliveries. */
  deliveries?: boolean;
  /** Emergency vehicles. */
  emergencyVehicles?: boolean;
  /** Motorcycles. */
  motorcycles?: boolean;
  /** Pedestrians. */
  pedestrians?: boolean;
  /** Taxis. */
  taxis?: boolean;
  /** Through traffic. */
  throughTraffic?: boolean;
  /** Trucks. */
  trucks?: boolean;
}

/** The physical characteristics of a road. */
export interface Physical {
  /** The segment is a boat ferry route. */
  boatFerry?: boolean;
  /** The road is a bridge. */
  bridge?: boolean;
  /** The road is a delivery road. */
  deliveryRoad?: boolean;
  /** The road is a bridge that moves to let boats pass. */
  movableBridge?: boolean;
  /** The road is digitised with one line per direction of traffic. */
  multiplyDigitized?: boolean;
  /** The road is paved. */
  paved?: boolean;
  /** The road is not maintained by a public body. */
  private?: boolean;
  /** The segment is a rail ferry route. */
  railFerry?: boolean;
  /** The road is a tunnel. */
  tunnel?: boolean;
}

/** The road attributes asked for with `showNavAttributes`. */
export interface NavigationAttributes {
  /** The speed limits, one per direction of traffic. With `bearing`, the first matches that direction. */
  speedLimits?: SpeedLimit[];
  /** The functional class of the road. */
  functionalClass?: FunctionalClass[];
  /** Which vehicles and travellers the road allows. */
  access?: Access[];
  /** The physical characteristics of the road. */
  physical?: Physical[];
}

/** A secondary unit recognized in the query, rendered with `show=secondaryUnitInfo`. */
export interface SecondaryUnitInfo {
  /** The unit designator in the normalized form of the country, or `unknown`. */
  normalizedUnitType: string;
  /** The unit value in normalized form. It may be empty, as for `Basement`. */
  unitValue: string;
}

/** A supplier of place references. */
export interface ReferenceSupplier {
  /** The supplier's identifier. */
  id: Open<
    | "booking.com"
    | "core"
    | "hereParking"
    | "nsr"
    | "parkopedia"
    | "ryd"
    | "tollCollect"
    | "tripadvisor"
    | "truckParkingClub"
    | "venues"
    | "vinfast"
    | "yelp"
  >;
}

/** The ID a supplier knows a place by. */
export interface SupplierReference {
  /** The supplier of the reference. */
  supplier: ReferenceSupplier;
  /** The place's ID at the supplier. */
  id: string;
  /** The categories the reference relates to. */
  categories?: CategoryRef[];
}

/** One way to contact a place. */
export interface Contact {
  /** A label, such as `Customer Service`. */
  label?: string;
  /** The number, address or URL. */
  value: string;
  /** The categories of the place the contact is for. */
  categories?: CategoryRef[];
}

/** The contacts of a place, by kind. */
export interface ContactInformation {
  /** Phone numbers. */
  phone?: Contact[];
  /** Mobile numbers. */
  mobile?: Contact[];
  /** Toll-free numbers. */
  tollFree?: Contact[];
  /** Fax numbers. */
  fax?: Contact[];
  /** Websites. */
  www?: Contact[];
  /** Email addresses. */
  email?: Contact[];
}

/** One span of opening hours in iCalendar terms. */
export interface StructuredOpeningHours {
  /** The start time, as an iCalendar DATE-TIME without its date, such as `T132000`. */
  start: string;
  /** The iCalendar DURATION. A closed day is `PT00:00M`. */
  duration: string;
  /** The RECUR rule, with a colon where the RFC has an equals sign. */
  recurrence: string;
}

/** When a place is open. A day without hours is closed. */
export interface OpeningHours {
  /** The categories of the place these hours are for. */
  categories?: CategoryRef[];
  /** The hours as text, one line per span of days. */
  text: string[];
  /** Whether the place is open at request time. */
  isOpen?: boolean;
  /** The hours in iCalendar terms. */
  structured: StructuredOpeningHours[];
}

/** A matched range of characters. */
export interface Range {
  /** The first index of the range, inclusive. */
  start: number;
  /** One past the last index of the range. */
  end: number;
}

/** The parts of each address field that matched the query. */
export interface AddressHighlightingInformation {
  /** Matches in the address label. */
  label?: Range[];
  /** Matches in the country. */
  country?: Range[];
  /** Matches in the country code. */
  countryCode?: Range[];
  /** Matches in the state. */
  state?: Range[];
  /** Matches in the state code. */
  stateCode?: Range[];
  /** Matches in the county. */
  county?: Range[];
  /** Matches in the county code. */
  countyCode?: Range[];
  /** Matches in the city. */
  city?: Range[];
  /** Matches in the district. */
  district?: Range[];
  /** Matches in the subdistrict. */
  subdistrict?: Range[];
  /** Matches in the block. */
  block?: Range[];
  /** Matches in the sub-block. */
  subblock?: Range[];
  /** Matches in the street. */
  street?: Range[];
  /** Matches in each street of an intersection. */
  streets?: Range[][];
  /** Matches in the postal code. */
  postalCode?: Range[];
  /** Matches in the house number. */
  houseNumber?: Range[];
  /** Matches in the building. */
  building?: Range[];
  /** Matches in the unit of a Micro Point Address (RESTRICTED). Autocomplete only. */
  unit?: Range[];
}

/** The parts of the title of a query item that matched the query. */
export interface TitleHighlighting {
  /** Matches in the title. */
  title?: Range[];
}

/** The parts of the title and the address that matched the query. */
export interface TitleAndAddressHighlighting extends TitleHighlighting {
  /** Matches in each address field. */
  address?: AddressHighlightingInformation;
}

/** A phonetic transcription of a name. */
export interface Phoneme {
  /** The transcription in NT-SAMPA. */
  value: string;
  /** The BCP 47 language code. */
  language?: string;
  /** Whether this is the preferred phoneme. */
  preferred?: boolean;
}

/** The phonemes of the names of an item, rendered with `show=phonemes`. */
export interface PhonemesSection {
  /** Phonemes of the place name. */
  placeName?: Phoneme[];
  /** Phonemes of the country name. */
  countryName?: Phoneme[];
  /** Phonemes of the state name. */
  state?: Phoneme[];
  /** Phonemes of the county name. */
  county?: Phoneme[];
  /** Phonemes of the city name. */
  city?: Phoneme[];
  /** Phonemes of the district name. */
  district?: Phoneme[];
  /** Phonemes of the subdistrict name. */
  subdistrict?: Phoneme[];
  /** Phonemes of the street name. */
  street?: Phoneme[];
  /** Phonemes of the block. */
  block?: Phoneme[];
  /** Phonemes of the sub-block. */
  subblock?: Phoneme[];
}

/** The price of a fuel or an additive (BETA, RESTRICTED). */
export interface FuelPrice {
  /** The price of one `unit`. */
  amount?: number;
  /** The currency of `amount`. */
  currency?: string;
  /** The unit priced. `l`, `gal`, `bbl`, `kg` or `m3`. */
  unit?: string;
}

/** An additive sold with a fuel (BETA, RESTRICTED). */
export interface FuelAdditive {
  /** The type of Diesel Emission Fluid. */
  type: Open<"aus32">;
  /** Whether the additive is available at the place. */
  available: boolean;
  /** Whether it is sold in cans. */
  inCans?: boolean;
  /** Whether it is sold at the pump. */
  atThePump?: boolean;
  /** The price of the additive. */
  price?: FuelPrice;
}

/** A car fuel of a fuel station, as autosuggest renders it (BETA, RESTRICTED). */
export interface CarFuelAutosuggest {
  /** The type of car fuel. */
  type: Open<CarFuelType>;
  /** Whether the fuel is available at the place. */
  available: boolean;
  /** The additives sold with the fuel. */
  additives?: FuelAdditive[];
  /** The pressures of hydrogen fuel, in bar. */
  pressures?: number[];
}

/** A truck fuel of a fuel station, as autosuggest renders it (BETA, RESTRICTED). */
export interface TruckFuelAutosuggest {
  /** The type of truck fuel. */
  type: Open<TruckFuelType>;
  /** Whether the fuel is available at the place. */
  available: boolean;
  /** The largest truck class that can fuel there. */
  maximumTruckClass?: Open<TruckClass>;
  /** Whether the truck diesel pumps have large nozzles. */
  largeNozzle?: boolean;
}

/** A car fuel of a fuel station (BETA, RESTRICTED). */
export interface CarFuel extends CarFuelAutosuggest {
  /** Whether the fuel was in stock at `lastUpdateTimestamp`. Given for hydrogen only. */
  stockAvailable?: boolean;
  /** The price of the fuel. */
  price?: FuelPrice;
  /** When the price and the stock were last updated, as an RFC 3339 timestamp. */
  lastUpdateTimestamp?: string;
}

/** A truck fuel of a fuel station (BETA, RESTRICTED). */
export interface TruckFuel extends TruckFuelAutosuggest {
  /** Whether the fuel was in stock at `lastUpdateTimestamp`. Given for hydrogen only. */
  stockAvailable?: boolean;
  /** The price of the fuel. */
  price?: FuelPrice;
  /** When the price and the stock were last updated, as an RFC 3339 timestamp. */
  lastUpdateTimestamp?: string;
}

/** The attributes of a fuel station, as autosuggest renders them (BETA, RESTRICTED). */
export interface FuelStationAttributesAutosuggest {
  /** The fuel types available or not available at the place. */
  fuelTypes?: (CarFuelAutosuggest | TruckFuelAutosuggest)[];
  /** Whether payment can be made at the pump. */
  payAtThePump?: boolean;
  /** Whether there are high volume pumps for commercial vehicles. */
  highVolumePumps?: boolean;
}

/** The attributes of a fuel station (BETA, RESTRICTED). */
export interface FuelStationAttributes {
  /** The fuel types available or not available at the place. */
  fuelTypes?: (CarFuel | TruckFuel)[];
  /** Whether payment can be made at the pump. */
  payAtThePump?: boolean;
  /** Whether there are high volume pumps for commercial vehicles. */
  highVolumePumps?: boolean;
}

/** An amenity for truck drivers (BETA, RESTRICTED). */
export interface TruckAmenityGeneric {
  /** The kind of amenity. */
  type: Open<
    | "carWash"
    | "chemicalToiletDisposal"
    | "convenienceStore"
    | "highCanopy"
    | "idleReduction"
    | "nightParkingOnly"
    | "paidParking"
    | "parking"
    | "powerSupply"
    | "reservableParking"
    | "secureParking"
    | "truckScales"
    | "truckService"
    | "truckStop"
    | "truckWash"
    | "wifi"
  >;
  /** Whether the amenity is available at the place. */
  available: boolean;
}

/** The showers at a place for truck drivers (BETA, RESTRICTED). */
export interface TruckAmenityShowers {
  /** The kind of amenity. */
  type: "showers";
  /** Whether showers are available at the place. */
  available: boolean;
  /** How many showers there are. */
  numberOfShowers?: number;
}

/** An amenity at a place for truck drivers. */
export type TruckAmenity = TruckAmenityGeneric | TruckAmenityShowers;

/** The extended attributes of an autosuggest item (BETA). */
export interface ExtendedAttributeAutosuggest {
  /** The attributes of a fuel station, rendered with `show=fuel`. */
  fuelStation?: FuelStationAttributesAutosuggest;
  /** The amenities for truck drivers, rendered with `show=truck`. */
  truckAmenities?: TruckAmenity[];
}

/** A name with its ID. */
export interface EvNameId {
  /** The name. */
  name?: string;
  /** The ID. */
  id?: string;
}

/** The charging details of a group of connectors. */
export interface EvChargingPoint {
  /** How many physical connectors the group has. */
  numberOfConnectors?: number;
  /** The voltage the group provides, such as `100-120V AC`. */
  voltsRange?: string;
  /** The highest voltage the group provides. */
  maxVoltage?: number;
  /** The number of phases the group provides. */
  phases?: number;
  /** The amperage the group provides, such as `12A-80A`. */
  ampsRange?: string;
  /** How many connectors are free. */
  numberOfAvailable?: number;
  /** How many connectors are in use. */
  numberOfInUse?: number;
  /** How many connectors are out of service. */
  numberOfOutOfService?: number;
  /** How many connectors are reserved. */
  numberOfReserved?: number;
  /** When the availability was last updated, as an RFC 3339 timestamp. */
  lastUpdateTimestamp?: string;
}

/** A group of connectors of one type and power level in an EV charging pool. */
export interface EvConnector {
  /** The charge point operator. */
  supplierName?: string;
  /** The connector type of the group. */
  connectorType?: EvNameId;
  /** Whether the station provides a cable for the group. */
  fixedCable?: boolean;
  /** The highest charge power of the group, in kW. */
  maxPowerLevel?: number;
  /** The charging details of the group. */
  chargingPoint?: EvChargingPoint;
}

/** An e-Mobility Service Provider with a roaming agreement at an EV station. */
export interface EMobilityServiceProvider {
  /** The provider's name. It may change, while the partner ID stays. */
  name: string;
  /** The provider's stable ID on the HERE platform. */
  partnerId: string;
}

/** Whether an EV station accepts a payment method. */
export interface EvPaymentSupport {
  /** The payment method. */
  id: Open<EvPaymentMethodId>;
  /** `true` when the station accepts the method. */
  accepted: boolean;
}

/** An EV charging pool, rendered with `show=ev`. */
export interface EvChargingAttributes {
  /** The groups of connectors, each of one type and power level. */
  connectors?: EvConnector[];
  /** How many connectors the pool has in total. */
  totalNumberOfConnectors?: number;
  /** Who may use the pool. */
  access?: Open<"private" | "public" | "restricted">;
  /** Why access to the pool is restricted. */
  restrictions?: Open<"brandOnly" | "carSharingOnly" | "customersOnly" | "other" | "taxisOnly">[];
  /** The providers with roaming agreements, rendered with `show=eMobilityServiceProviders`. */
  eMobilityServiceProviders?: EMobilityServiceProvider[];
  /** The payment methods of the station. */
  paymentMethods?: EvPaymentSupport[];
}

/** One connector of an EVSE. */
export interface EvAvailabilityConnector {
  /** The HERE ID of the connector. Deprecated in favour of `cpoId`. */
  id?: string;
  /** The connector's ID in the system of the charge point operator. */
  cpoId?: string;
  /** The connector type ID. */
  typeId?: string;
  /** The highest charge power of the connector, in kW. */
  maxPowerLevel?: number;
}

/** One EVSE (electric vehicle supply equipment) of an EV station. */
export interface EvAvailabilityEvse {
  /** The HERE ID of the EVSE. Deprecated in favour of `cpoId` and `cpoEvseEMI3Id`. */
  id?: string;
  /** The EVSE's ID in the system of the charge point operator. */
  cpoId?: string;
  /** The EVSE's global ID in eMI3 format, such as `DE*ICT*E0001897`. */
  cpoEvseEMI3Id?: string;
  /** The status of the EVSE. */
  state?: Open<
    "AVAILABLE" | "OCCUPIED" | "OFFLINE" | "OTHER" | "OUT_OF_SERVICE" | "RESERVED" | "UNAVAILABLE"
  >;
  /** When the availability was last updated, as an RFC 3339 timestamp. */
  last_updated?: string;
  /** The connectors of the EVSE. */
  connectors?: EvAvailabilityConnector[];
}

/** One EV station of a place. */
export interface EvAvailabilityStation {
  /** The HERE ID of the station. */
  id?: string;
  /** The station's ID in the system of the charge point operator. */
  cpoId?: string;
  /** The EVSE of the station. */
  evses?: EvAvailabilityEvse[];
}

/** The live availability of an EV charging pool, rendered with `show=ev`. */
export interface EvAvailabilityAttributes {
  /** The EV stations at the place. */
  stations?: EvAvailabilityStation[];
}

/** The extended attributes of a place. */
export interface ExtendedAttribute {
  /** The EV charging pool, rendered with `show=ev`. */
  evStation?: EvChargingAttributes;
  /** The live availability of the EV charging pool, rendered with `show=ev`. */
  evAvailability?: EvAvailabilityAttributes;
  /** The attributes of a fuel station, rendered with `show=fuel` (BETA, RESTRICTED). */
  fuelStation?: FuelStationAttributes;
  /** The amenities for truck drivers, rendered with `show=truck` (BETA, RESTRICTED). */
  truckAmenities?: TruckAmenity[];
}

/** The supplier of a piece of media. */
export interface TripadvisorMediaSupplier {
  /** The supplier's identifier. */
  id: "tripadvisor";
}

/** One size of an image. */
export interface TripadvisorImageVariant {
  /** The URL of the image. */
  href: string;
}

/** The sizes of an image, rendered with `show=tripadvisorImageVariants`. */
export interface TripadvisorImageVariants {
  /** A 50 by 50 pixel crop. */
  thumbnail?: TripadvisorImageVariant;
  /** A 150 by 150 pixel crop. */
  small?: TripadvisorImageVariant;
  /** At most 250 pixels on its longer side. */
  medium?: TripadvisorImageVariant;
  /** At most 550 pixels on its longer side. */
  large?: TripadvisorImageVariant;
  /** The original resolution. */
  original?: TripadvisorImageVariant;
}

/** An image of a place. */
export interface TripadvisorImage {
  /** The URL of the default image, usually of medium size. */
  href: string;
  /** The supplier of the image. */
  supplier: TripadvisorMediaSupplier;
  /** The sizes of the image. */
  variants?: TripadvisorImageVariants;
}

/** The images of a place. */
export interface ImageMediaCollection {
  /** The images. */
  items: TripadvisorImage[];
}

/** A text that describes a place. */
export interface Editorial {
  /** The text. */
  description: string;
  /** The language of the text. */
  language: string;
  /** A link to the source of the text. */
  href?: string;
  /** The supplier of the text. */
  supplier: TripadvisorMediaSupplier;
}

/** The editorials of a place. */
export interface EditorialMediaCollection {
  /** The editorials. */
  items: Editorial[];
}

/** A supplier's rating of a place. */
export interface Rating {
  /** How many user reviews the supplier has. */
  count: number;
  /** The average of the user ratings. */
  average: number;
  /** A link to the source of the rating. */
  href?: string;
  /** The supplier of the rating. */
  supplier: TripadvisorMediaSupplier;
}

/** The ratings of a place. */
export interface RatingMediaCollection {
  /** The ratings. */
  items: Rating[];
}

/** Images, editorials and ratings of a place (BETA, RESTRICTED). Rendered with `show=tripadvisor`. */
export interface Media {
  /** The images. */
  images?: ImageMediaCollection;
  /** The editorials. */
  editorials?: EditorialMediaCollection;
  /** The ratings. */
  ratings?: RatingMediaCollection;
}

/** A known restriction on who may enter a place. */
export interface AccessRestrictionAttributes {
  /** The categories of the place the restriction is for. */
  categories?: CategoryRef[];
  /** `true` when access is restricted. It is never `false`. */
  restricted?: boolean;
}

// Result items

/** A result of `/v1/geocode`. */
export interface GeocodeResultItem {
  /** The localized display name. */
  title: string;
  /** The ID of the item, which `/v1/lookup` accepts. */
  id: string;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The type of the item. */
  resultType?: ResultType;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** Whether the address is residential (ALPHA, RESTRICTED). */
  addressUsage?: AddressUsage;
  /** The kind of an `addressBlock` item. */
  addressBlockType?: AddressBlockType;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** The postal address. */
  address: Address;
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** Details of a `postalCodePoint` item, rendered with `show=postalCodeDetails`. */
  postalCodeDetails?: PostalCodeDetails[];
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links, for driving or walking to the item. */
  access?: BasicAccessPoint[];
  /** Metres from the search centre, as the crow flies. */
  distance?: number;
  /** The bounding box of the item. A `place` has none. */
  mapView?: MapView;
  /** The categories of a place. */
  categories?: Category[];
  /** The food types of a place. */
  foodTypes?: Category[];
  /** Present, and `true`, when the nearest known house number stands in for the one asked for. */
  houseNumberFallback?: boolean;
  /** Present, and `true`, when the coordinates of a point address are estimated. */
  estimatedPointAddress?: boolean;
  /** The time zone, rendered with `show=tz`. */
  timeZone?: TimeZoneInfo;
  /** How well the item matches the query. */
  scoring?: Scoring;
  /** How the query was read, rendered with `show=parsing`. */
  parsing?: Parsing;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
  /** The codes of the country, rendered with `show=countryInfo`. */
  countryInfo?: CountryInfo;
  /** Every translation of the fields asked for with `showTranslations`. */
  translations?: Translations;
  /** The map references asked for with `showMapReferences`. */
  mapReferences?: MapReferenceSection;
  /** The related items asked for with `showRelated`. */
  related?: RelatedAddress[];
  /** The road attributes asked for with `showNavAttributes`. */
  navigationAttributes?: NavigationAttributes;
  /** The secondary units recognized in the query, rendered with `show=secondaryUnitInfo`. */
  secondaryUnitInfo?: SecondaryUnitInfo[];
}

/** A result of `/v1/revgeocode` and `/v1/multi-revgeocode`. */
export interface ReverseGeocodeResultItem {
  /** The localized display name. */
  title: string;
  /** The ID of the item, which `/v1/lookup` accepts. */
  id: string;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The type of the item. Reverse geocode returns no `intersection`. */
  resultType?: ResultType;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** Whether the address is residential (ALPHA, RESTRICTED). */
  addressUsage?: AddressUsage;
  /** The kind of an `addressBlock` item. */
  addressBlockType?: AddressBlockType;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** The postal address. */
  address: RgcAddress;
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** Details of a `postalCodePoint` item, rendered with `show=postalCodeDetails`. */
  postalCodeDetails?: (PostalCodeDetailsUspsZip | PostalCodeDetailsUspsZipPlus4)[];
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links, for driving or walking to the item. */
  access?: BasicAccessPoint[];
  /** Metres from the search centre, as the crow flies. */
  distance?: number;
  /** The bounding box of the item. A `place` has none. */
  mapView?: MapView;
  /** The categories of a place. */
  categories?: Category[];
  /** The food types of a place. */
  foodTypes?: Category[];
  /** Present, and `true`, when the nearest known house number stands in for the one asked for. */
  houseNumberFallback?: boolean;
  /** Present, and `true`, when the coordinates of a point address are estimated. */
  estimatedPointAddress?: boolean;
  /** The time zone, rendered with `show=tz`. */
  timeZone?: TimeZoneInfo;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
  /** The codes of the country, rendered with `show=countryInfo`. */
  countryInfo?: CountryInfo;
  /** `true` when the area comes from the closest street and not from a shape (ALPHA). */
  estimatedAreaFallback?: boolean;
  /** The map references asked for with `showMapReferences`. */
  mapReferences?: MapReferenceSection;
  /** The related items asked for with `showRelated`. */
  related?: RelatedAddress[];
  /** The road attributes asked for with `showNavAttributes`. */
  navigationAttributes?: NavigationAttributes;
}

/** An address or a place suggested by `/v1/autosuggest`. */
export interface AutosuggestEntityResultItem {
  /** The localized display name. */
  title: string;
  /** The ID of the item, which `/v1/lookup` accepts. */
  id: string;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The related ontology ID. */
  ontologyId?: string;
  /** The type of the item. */
  resultType?: ResultType;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** The kind of an `addressBlock` item. */
  addressBlockType?: AddressBlockType;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** The postal address. */
  address: Address;
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links. A place may have several. */
  access?: ExtendedAccessPoint[];
  /** `true` when customers are served without leaving their cars. */
  driveThrough?: boolean;
  /** Metres from the search centre. Along a route, the metres along it plus those from it to the item. */
  distance?: number;
  /** Twice the metres from the route to the item, when searching along a route. */
  excursionDistance?: number;
  /** The bounding box of the item. A `place` has none. */
  mapView?: MapView;
  /** The categories of a place. */
  categories?: Category[];
  /** The chains of a place. */
  chains?: Chain[];
  /** The IDs suppliers know the place by. */
  references?: SupplierReference[];
  /** The food types of a place. */
  foodTypes?: Category[];
  /** The contacts of a place. */
  contacts?: ContactInformation[];
  /** When the place is open. Absent when HERE has no data. */
  openingHours?: OpeningHours[];
  /** The time zone, rendered with `show=tz`. */
  timeZone?: TimeZoneInfo;
  /** The parts of the title and the address that matched the query. */
  highlights?: TitleAndAddressHighlighting;
  /** The phonemes of the names, rendered with `show=phonemes`. */
  phonemes?: PhonemesSection;
  /** The extended attributes of the item (BETA). */
  extended?: ExtendedAttributeAutosuggest;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
  /** The known restrictions on who may enter the place. */
  accessRestrictions?: AccessRestrictionAttributes[];
  /** The map references asked for with `showMapReferences`. */
  mapReferences?: MapReferenceSectionAS;
}

/** A follow-up query suggested by `/v1/autosuggest`, for a category or a chain. */
export interface AutosuggestQueryResultItem {
  /** The localized display name. */
  title: string;
  /** The ID of the item. `/v1/lookup` does not accept it. */
  id: string;
  /** The type of the item. */
  resultType?: Open<"categoryQuery" | "chainQuery">;
  /** Present, and `true`, on a chain query whose `href` is likely to find nothing. */
  noResultOnFollowUp?: boolean;
  /** The URL of the follow-up query. It carries no `apiKey`. */
  href?: string;
  /** The parts of the title that matched the query. */
  highlights?: TitleHighlighting;
}

/** One suggestion of `/v1/autosuggest`. `resultType` tells the two kinds apart. */
export type AutosuggestResultItem = AutosuggestEntityResultItem | AutosuggestQueryResultItem;

/** A suggestion for one term of the query. */
export interface QueryTermResultItem {
  /** The term to suggest to the user. */
  term: string;
  /** The part of the query the term replaces. */
  replaces: string;
  /** The first code point of the replaced text in the query, inclusive. */
  start: number;
  /** One past the last code point of the replaced text in the query. */
  end: number;
}

/** A result of `/v1/autocomplete`. It has no position, so follow with `/v1/lookup` for one. */
export interface AutocompleteResultItem {
  /** The display name, composed the same way for every result so parts of it can be highlighted. */
  title: string;
  /** The ID of the item, which `/v1/lookup` accepts. */
  id: string;
  /** The preferred language of the address elements. */
  language?: string;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The type of the item. Autocomplete returns no `place` and no `addressBlock`. */
  resultType?: ResultType;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** Present, and `true`, when the coordinates of a point address are estimated. */
  estimatedPointAddress?: boolean;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** The address of the item. */
  address: Address;
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** Metres from the search centre, as the crow flies. */
  distance?: number;
  /** The parts of the title and the address that matched the query. */
  highlights?: TitleAndAddressHighlighting;
  /** Whether sub-premises belong to the house number (ALPHA, RESTRICTED). Rendered with `show=hasRelatedMPA`. */
  hasRelatedMPA?: boolean;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
}

/** A result of `/v1/browse`. */
export interface BrowseResultItem {
  /** The localized display name. */
  title: string;
  /** The ID of the item, which `/v1/lookup` accepts. */
  id: string;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The type of the item. */
  resultType?: ResultType;
  /** The kind of an `addressBlock` item. */
  addressBlockType?: AddressBlockType;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** The postal address. */
  address: Address;
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links. A place may have several. */
  access?: ExtendedAccessPoint[];
  /** `true` when customers are served without leaving their cars. */
  driveThrough?: boolean;
  /** Metres from the search centre. Along a route, the metres along it plus those from it to the item. */
  distance?: number;
  /** Twice the metres from the route to the item, when searching along a route. */
  excursionDistance?: number;
  /** The bounding box of the item. A `place` has none. */
  mapView?: MapView;
  /** The categories of a place. */
  categories?: Category[];
  /** The chains of a place. */
  chains?: Chain[];
  /** The IDs suppliers know the place by. */
  references?: SupplierReference[];
  /** The food types of a place. */
  foodTypes?: Category[];
  /** The contacts of a place. */
  contacts?: ContactInformation[];
  /** When the place is open. Absent when HERE has no data. */
  openingHours?: OpeningHours[];
  /** The time zone, rendered with `show=tz`. */
  timeZone?: TimeZoneInfo;
  /** The extended attributes of the place. */
  extended?: ExtendedAttribute;
  /** The phonemes of the names, rendered with `show=phonemes`. */
  phonemes?: PhonemesSection;
  /** Images, editorials and ratings (BETA, RESTRICTED). */
  media?: Media;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
  /** The known restrictions on who may enter the place. */
  accessRestrictions?: AccessRestrictionAttributes[];
}

/** A result of `/v1/discover`. Only `title`, `id`, `resultType` and `position` come with every result. */
export interface OneboxSearchResultItem extends BrowseResultItem {
  /** The related ontology ID. */
  ontologyId?: string;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** Present, and `true`, when the nearest known house number stands in for the one asked for. */
  houseNumberFallback?: boolean;
}

// Responses

/** The answer of `/v1/geocode`. No match is an empty `items`. */
export interface OpenSearchGeocodeResponse {
  /** The candidates, most likely first. */
  items: GeocodeResultItem[];
}

/** The answer of `/v1/revgeocode`. */
export interface OpenSearchReverseGeocodeResponse {
  /** The candidates, most likely first. */
  items: ReverseGeocodeResultItem[];
}

/** The answer to one sub-request of `/v1/multi-revgeocode` that succeeded. */
export interface OpenSearchMultiReverseGeocodeResponseItem {
  /** The `id` the caller gave the sub-request. */
  id: string;
  /** The candidates, most likely first. */
  items: ReverseGeocodeResultItem[];
}

/** What went wrong with one sub-request. */
export interface MultiResultErrorSection {
  /** A description of the error. */
  title: string;
}

/** The answer to one sub-request of `/v1/multi-revgeocode` that failed. */
export interface OpenSearchMultiReverseGeocodeErrorResult {
  /** The `id` the caller gave the sub-request. */
  id: string;
  /** What went wrong. */
  error: MultiResultErrorSection;
}

/** The answer of `/v1/multi-revgeocode`. */
export interface OpenSearchMultiReverseGeocodeResponse {
  /** One entry per sub-request, with either `items` or `error`. */
  results: (OpenSearchMultiReverseGeocodeResponseItem | OpenSearchMultiReverseGeocodeErrorResult)[];
}

/** The paging fields of an answer. They are present only when the request set `offset` (ALPHA). */
export interface Paging {
  /** The offset of this page in the full list. */
  offset?: number;
  /** The offset of the next page. Absent on the last page. */
  nextOffset?: number;
  /** How many items this page has. */
  count?: number;
  /** The most items a page has, as the request set it. */
  limit?: number;
}

/** The answer of `/v1/autosuggest`. */
export interface OpenSearchAutosuggestResponse extends Paging {
  /** The suggestions, most relevant first. */
  items: AutosuggestResultItem[];
  /** Suggestions for single terms of the query. Empty unless `termsLimit` is above 0. */
  queryTerms: QueryTermResultItem[];
}

/** The answer of `/v1/autocomplete`. */
export interface OpenSearchAutocompleteResponse {
  /** The candidates, most likely first. */
  items: AutocompleteResultItem[];
}

/** The answer of `/v1/discover`. */
export interface OpenSearchSearchResponse extends Paging {
  /** The results, most relevant first. */
  items: OneboxSearchResultItem[];
}

/** The answer of `/v1/browse`. */
export interface OpenSearchBrowseResponse extends Paging {
  /** The results, nearest first. */
  items: BrowseResultItem[];
}

/** The answer of `/v1/lookup`. It is the item itself, with no `items` around it. */
export interface LookupResponse {
  /** The localized display name. */
  title: string;
  /** The ID of the item. */
  id: string;
  /** Whether the place has closed for good (ALPHA). `maybe` means it is likely. */
  closedPermanently?: Open<"maybe" | "yes">;
  /** The ISO 3166-1 alpha-3 code of the political view, when the request set one. */
  politicalView?: string;
  /** The type of the item. */
  resultType?: ResultType;
  /** How the house number was located. */
  houseNumberType?: HouseNumberType;
  /** Whether the address is residential (ALPHA, RESTRICTED). */
  addressUsage?: AddressUsage;
  /** The kind of an `addressBlock` item. */
  addressBlockType?: AddressBlockType;
  /** The kind of a `locality` item. */
  localityType?: LocalityType;
  /** The kind of an `administrativeArea` item. */
  administrativeAreaType?: AdministrativeAreaType;
  /** Present, and `true`, when the nearest known house number stands in for the one asked for. */
  houseNumberFallback?: boolean;
  /** Present, and `true`, when the coordinates of a point address are estimated. */
  estimatedPointAddress?: boolean;
  /** The postal address. */
  address: Address;
  /** Details of a `postalCodePoint` item, rendered with `show=postalCodeDetails`. */
  postalCodeDetails?: PostalCodeDetails[];
  /** The coordinates of a pin on a map. */
  position?: DisplayResponseCoordinate;
  /** The points on navigable links. A place may have several. */
  access?: ExtendedAccessPoint[];
  /** `true` when customers are served without leaving their cars. */
  driveThrough?: boolean;
  /** The bounding box of the item. A `place` has none. */
  mapView?: MapView;
  /** The categories of a place. */
  categories?: Category[];
  /** The chains of a place. */
  chains?: Chain[];
  /** The IDs suppliers know the place by. */
  references?: SupplierReference[];
  /** The food types of a place. */
  foodTypes?: Category[];
  /** The contacts of a place. */
  contacts?: ContactInformation[];
  /** When the place is open. Absent when HERE has no data. */
  openingHours?: OpeningHours[];
  /** The time zone, rendered with `show=tz`. */
  timeZone?: TimeZoneInfo;
  /** Images, editorials and ratings (BETA, RESTRICTED). */
  media?: Media;
  /** The extended attributes of the place. */
  extended?: ExtendedAttribute;
  /** The phonemes of the names, rendered with `show=phonemes`. */
  phonemes?: PhonemesSection;
  /** The street name split into its parts, rendered with `show=streetInfo`. */
  streetInfo?: StreetInfo[];
  /** The codes of the country, rendered with `show=countryInfo`. */
  countryInfo?: CountryInfo;
  /** The map references asked for with `showMapReferences`. */
  mapReferences?: MapReferenceSection;
  /** The related items asked for with `showRelated`. */
  related?: RelatedAddress[];
  /** The names in the language asked for with `showLocalizedNames`. */
  localizedNames?: LocalizedNames;
  /** The road attributes asked for with `showNavAttributes`. */
  navigationAttributes?: NavigationAttributes;
  /** The known restrictions on who may enter the place. */
  accessRestrictions?: AccessRestrictionAttributes[];
}

/** The error body of Geocoding and Search. It is the whole body, with nothing around it. */
export interface ErrorResponse {
  /** The HTTP status code. */
  status: number;
  /** A description of the error. */
  title: string;
  /** The error code. */
  code?: string;
  /** Why the error happened. */
  cause?: string;
  /** What the caller can do about it. */
  action?: string;
  /** HERE's own ID for the request. */
  correlationId: string;
  /** The ID the caller sent as `X-Request-ID`. */
  requestId: string;
}

// Batch API v7

/** The service a batch job runs every record against. One job wraps exactly one service. */
export type BatchServiceHrn =
  | "hrn:here:service::olp-here:search-geocode-7"
  | "hrn:here:service::olp-here:search-revgeocode-7"
  | "hrn:here:service::olp-here:search-lookup-7";

/**
 * The status of a batch job.
 *
 * - `submitted`: created, with its input uploaded, and not started.
 * - `queued`: started, and waiting for capacity.
 * - `pending`: being prepared to run.
 * - `inProgress`: running.
 * - `completed`: done.
 * - `stopped`: halted by the user. `start` resumes it, and its partial results can be downloaded.
 * - `deleted`: deleted by the user. Its results are gone.
 * - `failure`: failed inside HERE.
 */
export type BatchJobStatus = Open<
  | "submitted"
  | "queued"
  | "pending"
  | "inProgress"
  | "completed"
  | "stopped"
  | "deleted"
  | "failure"
>;

/** A status to filter jobs by. A deleted job cannot be filtered for. */
export type BatchJobStatusFilter =
  | "any"
  | "submitted"
  | "queued"
  | "pending"
  | "inProgress"
  | "completed"
  | "stopped"
  | "failure";

/** Parameters of `POST /v7/batch/jobs`. Everything but `body` and `contentEncoding` is a query parameter. */
export interface BatchCreateParams {
  /**
   * The input, one record per line. The first line names the columns unless `inputColumns` does.
   * A line may also be a URL query string, such as `q=Invalidenstraße 116 Berlin&limit=5`.
   */
  body: string | Blob | BufferSource;
  /** `gzip` when `body` is gzipped. It is sent as the `Content-Encoding` header. */
  contentEncoding?: "gzip" | undefined;
  /** The service every record runs against. */
  serviceHrn: BatchServiceHrn;
  /** A name for one or more jobs, which `list` and `deleteMany` can filter by. */
  tag?: string | undefined;
  /** Up to 6 billing tags of 4 to 16 characters each. A string joins them with `+` or `,`. */
  billingTags?: string | readonly string[] | undefined;
  /** The delimiter of the input columns. Default `|`. A tab is written `\t`, as two characters. */
  inputDelimiter?: string | undefined;
  /** The delimiter of the output columns. Default `|`. Space, period, quotes and parentheses are not allowed. */
  outputDelimiter?: string | undefined;
  /** The input columns, for input without a header line. It wins over a header line. At most 1024 characters. */
  inputColumns?: string | readonly string[] | undefined;
  /** The output columns of a `csv` job, such as `recId,position,addressLabel`. At most 1024 characters. */
  outputColumns?: string | readonly string[] | undefined;
  /** The fields a `jsonl` job keeps, as paths such as `position,title,address.label`. At most 1024 characters. */
  outputFilter?: string | readonly string[] | undefined;
  /** Whether the job starts once created. Default `true`. With `false` it waits for `start`. */
  startJob?: boolean | undefined;
  /** The format of the results. Default `csv`. `jsonl` is ALPHA. */
  outputType?: "csv" | "jsonl" | undefined;
  /** The notifications to call when the job ends (BETA). At most 5. */
  notificationIds?: string | readonly string[] | undefined;
}

/** Parameters of `GET /v7/batch/jobs`. */
export interface BatchListParams {
  /** The most jobs per page. From 1 to 100, default 100. */
  limit?: number | undefined;
  /** How many jobs to skip. Default 0. */
  offset?: number | undefined;
  /** The status to list jobs of. Default `any`. */
  status?: BatchJobStatusFilter | undefined;
  /** The tag to list jobs of. */
  tag?: string | undefined;
}

/** Parameters of `DELETE /v7/batch/jobs`. */
export interface BatchDeleteManyParams {
  /** The status to delete jobs of. It is required, as a safeguard. */
  status: BatchJobStatusFilter;
  /** The tag to delete jobs of. */
  tag?: string | undefined;
}

/** The job a call is about. */
export interface BatchJobParams {
  /** The ID of the job, such as `JOB-3fa85f64-5717-4562-b3fc-2c963f66afa6`. */
  jobId: string;
}

/** What `create`, `start`, `stop` and `delete` answer with. */
export interface JobResponse {
  /** The ID HERE gave the job when it was created. */
  id: string;
  /** The service the job runs against. */
  serviceHrn: Open<BatchServiceHrn>;
  /** The tag of the job. Absent when none was given. */
  tag?: string;
  /** The billing tags of the job. */
  billingTags?: string[];
  /** The status of the job. */
  status: BatchJobStatus;
  /** The URL of the job's details. */
  href?: string;
}

/** The record counters of a job. When it completes, `valid + invalid = total` and `succeeded + failed = processed`. */
export interface JobRecords {
  /** How many records the job has. An estimate while the job is queued. */
  total?: number;
  /** How many records are valid. */
  valid?: number;
  /** How many records are invalid. */
  invalid?: number;
  /** How many records have been processed. */
  processed?: number;
  /** How many records are still to be processed. */
  pending?: number;
  /** How many records succeeded. */
  succeeded?: number;
  /** How many records failed. */
  failed?: number;
}

/** The details of a job. */
export interface JobDetailResponse extends JobResponse {
  /** When the job was created, as an RFC 3339 timestamp. */
  created: string;
  /** When the job started. Absent until it has. */
  started?: string;
  /** When the job ended. Absent until it has. */
  ended?: string;
  /** The record counters. Absent for a job deleted before it started. */
  records?: JobRecords;
  /** The URL of the results, or `""` when there are none. */
  resultsHref?: string;
  /** The URL of the error report, or `""` when there is none. */
  errorsHref?: string;
  /** The format of the results. */
  outputType?: Open<"csv" | "jsonl">;
  /** The notifications called when the job ends. */
  notificationIds?: string[];
}

/** A page of jobs. */
export interface PaginatedJobDetailResponse {
  /** The most jobs per page. */
  limit?: number;
  /** How many jobs this page has. */
  count: number;
  /** The jobs. */
  items?: JobDetailResponse[];
}

/** The jobs that `deleteMany` deleted. */
export interface JobsDeletedResponse {
  /** How many jobs were deleted. */
  total: number;
  /** The IDs of the deleted jobs. */
  jobIds: string[];
}

/** One line of the results of a `jsonl` job. Each line of the file parses to one of these. */
export interface BatchJsonlRecord<
  Item = GeocodeResultItem | ReverseGeocodeResultItem | LookupResponse,
> {
  /** The `recId` of the input record. */
  recId: string;
  /** Every result of the record. Empty when nothing matched. */
  results: Item[];
}

/** What a webhook notification is configured with. */
export interface NotificationConfig {
  /**
   * The URL called with GET when a job ends. Placeholders such as `${JOB_ID}` and `${JOB_STATUS}`
   * in its path or query are filled in.
   */
  url: string;
}

/** A hook called when a job ends (BETA). */
export interface Notification {
  /** The ID HERE gave the notification, such as `NOTIFICATION-3fa85f64-5717-4562-b3fc-2c963f66afa6`. */
  id: string;
  /** The type of the notification. */
  type: Open<"webHook">;
  /** When the notification was last used. */
  lastUsedTime?: string;
  /** The settings of the type. */
  config: NotificationConfig;
}

/** Parameters of `POST /v7/batch/notifications`, sent as the JSON body. */
export interface NotificationCreateParams {
  /** The type of the notification. Default `webHook`. */
  type?: Open<"webHook"> | undefined;
  /** The settings of the type. */
  config: NotificationConfig;
}

/** The notification a call is about. */
export interface NotificationParams {
  /** The ID of the notification. */
  notificationId: string;
}

/** Parameters of `PUT /v7/batch/notifications/{notificationId}`. Everything but the ID is the JSON body. */
export interface NotificationUpdateParams extends NotificationParams, NotificationCreateParams {}

/** The version of one data set the service uses. */
export interface DataVersion {
  /** The name of the data set. */
  name: string;
  /** The version of the data set. */
  version: string;
}

/** The answer of `GET /v7/version`. */
export interface VersionResponse {
  /** The version of the API, such as `v7`. */
  apiVersion: string;
  /** The version of the service. */
  serviceVersion: string;
  /** The versions of the data sets the service uses. */
  dataVersions?: DataVersion[];
}

/** The answer of `GET /v7/health`. */
export interface HealthResponse {
  /** `ok` when the service works, `fail` when it does not. */
  status?: Open<"ok" | "fail">;
}

/** The error body of the Batch API. It has no `requestId`. */
export interface BatchErrorResponse {
  /** A description of the error. */
  title: string;
  /** The HTTP status code. */
  status: number;
  /** The error code, such as `E6004041`. */
  code: string;
  /** Why the error happened. */
  cause: string;
  /** What the caller can do about it. */
  action: string;
  /** HERE's own ID for the request. */
  correlationId: string;
}

/** The body of a 401 or a 403 from the Batch API. */
export interface AuthErrorResponse {
  /** The error, such as `Unauthorized`. */
  error: string;
  /** A description of the error. */
  error_description: string;
}
