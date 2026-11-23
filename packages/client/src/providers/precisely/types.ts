/**
 * The requests and responses of Precisely's Data Integrity Suite APIs, as Precisely writes them.
 * The token call, real-time Geo Addressing v1 and Bulk Geo Addressing v2.
 */

// Shared request objects

/** The unit of a {@link Distance}. */
export type DistanceUnit = "FOOT" | "METER" | "MILE" | "KILOMETER";

/** A length with its unit. */
export interface Distance {
  /** The length, in `distanceUnit`. */
  value: number;
  /** The unit `value` is in. */
  distanceUnit: DistanceUnit;
}

/** The features a {@link FactoryDescription} can name a label for. */
export type FactoryFeature =
  | "GEOCODE"
  | "PARSE"
  | "VERIFY"
  | "REVERSE_GEOCODE"
  | "INTERACTIVE"
  | "LOOKUP";

/** Which of Precisely's engines answers. */
export interface FactoryDescription {
  /** The engine's label, in lower case. Default `""`. */
  label?: string | undefined;
  /** A label per feature, such as `{ LOOKUP: "ggs" }`. */
  featureSpecific?: Partial<Record<FactoryFeature, string>> | undefined;
}

/** A locale in its object form. Precisely's own examples send the string form, such as `"en_US"`. */
export interface Locale {
  /** The language code, such as `en`. */
  language?: string | undefined;
  /** The script code, such as `Latn`. */
  script?: string | undefined;
  /** The country code, such as `US`. */
  country?: string | undefined;
  /** The variant of the locale. */
  variant?: string | undefined;
  /** The Unicode locale attributes. */
  unicodeLocaleAttributes?: string[] | undefined;
  /** The Unicode locale keys. */
  unicodeLocaleKeys?: Record<string, string> | undefined;
  /** The extension keys. */
  extensionKeys?: Record<string, string> | undefined;
}

/** How strictly the input must match. `STANDARD` is the default. */
export type MatchMode = "EXACT" | "STANDARD" | "RELAXED" | "";

/** The preferences every operation accepts. */
export interface Preferences {
  /** The most candidates answered per item. Default 1. */
  maxResults?: number | undefined;
  /** Whether every available field of a candidate is returned. */
  returnAllInfo?: boolean | undefined;
  /** Which of Precisely's engines answers. */
  factoryDescription?: FactoryDescription | undefined;
  /**
   * Free-form settings, all strings, such as `{ DATA_OPTION: "PREMIUM" }`.
   * The documented keys are `DATA_OPTION`, `DATA_VERSION` and `RETURN_PARSED_INPUT`.
   */
  customPreferences?: Record<string, string> | undefined;
  /** The caller's locale, as a string such as `"en_US"` or as an object. */
  clientLocale?: string | Locale | undefined;
  /** The coordinate system of the answer, as an EPSG or SRID code. Default `EPSG:4326`. */
  clientCoordSysName?: string | undefined;
  /** The search radius. Default 5 metres. */
  distance?: Distance | undefined;
  /** How far a point is set back from its street segment. */
  streetOffset?: Distance | undefined;
  /** How far a point is set back from the end of its street. Default 7 metres. */
  cornerOffset?: Distance | undefined;
  /** Whether an address that is not found falls back to the centroid of its town or region. */
  fallbackToGeographic?: boolean | undefined;
  /** Whether an address that is not found falls back to the centroid of its postal code. */
  fallbackToPostal?: boolean | undefined;
  /** How strictly the input must match. */
  matchMode?: MatchMode | undefined;
  /** The origin point, as x and y. */
  originXY?: number[] | undefined;
  /** Fields to return when `returnAllInfo` is off, such as `RESULT_CODE` or `PRECISION_CODE`. */
  returnOfAdditionalFields?: string[] | undefined;
}

/** One field of a {@link FilterBias}. */
export interface FilterBiasValue {
  /** The value to keep, to drop or to prefer. */
  value: string;
}

/** Narrows or ranks the predictions of `/v2/express-autocomplete`. */
export interface FilterBias {
  /** `filter` drops what does not match, and `bias` only ranks it lower. */
  type: "bias" | "filter";
  /** The fields to match, by name. */
  fields: {
    /** Fields a prediction should have. */
    include?: Record<string, FilterBiasValue> | undefined;
    /** Fields a prediction should not have. */
    exclude?: Record<string, FilterBiasValue> | undefined;
  };
}

/** The preferences of `/v2/express-autocomplete`. */
export interface AutocompleteV2Preferences extends Preferences {
  /** Narrows or ranks the predictions. */
  filterBias?: FilterBias | undefined;
}

/** An input address. Only `country` is required. */
export interface RequestAddress {
  /** The address as written, unparsed. Precisely's examples put the whole address in one line. */
  addressLines?: string[] | undefined;
  /** The country, as an ISO 3166-1 alpha-2, alpha-3 or numeric code. */
  country: string;
  /** The house number. */
  addressNumber?: string | undefined;
  /** The street name. */
  street?: string | undefined;
  /** The city or town. */
  city?: string | undefined;
  /** The state or province. */
  admin1?: string | undefined;
  /** The county or district. */
  admin2?: string | undefined;
  /** The borough. */
  borough?: string | undefined;
  /** The neighbourhood. */
  neighborhood?: string | undefined;
  /** The suburb. */
  suburb?: string | undefined;
  /** The postal code. */
  postalCode?: string | undefined;
  /** The extension of the postal code, such as the four digits after a ZIP code. */
  postalCodeExt?: string | undefined;
  /** The name of the place, such as a business or a landmark. */
  placeName?: string | undefined;
  /** The building. */
  building?: string | undefined;
  /** The floor. */
  floor?: string | undefined;
  /** The room. */
  room?: string | undefined;
  /** The unit, such as `300`. */
  unit?: string | undefined;
  /** The kind of unit, such as `STE`. */
  unitType?: string | undefined;
}

/** An input address of a batch, with the ID its answer echoes. */
export interface RequestAddressWithId extends RequestAddress {
  /** The caller's own ID for the item, echoed in its answer. */
  addressId?: string | undefined;
}

/** A point to reverse geocode. */
export interface LocationDetail {
  /** The caller's own ID for the item, echoed in its answer. */
  addressId?: string | undefined;
  /** The longitude, which is x. */
  longitude: number;
  /** The latitude, which is y. */
  latitude: number;
  /** The country, as an ISO 3166-1 alpha-2 or alpha-3 code or a common name. */
  country: string;
}

/** The kinds of key `/v1/lookup` takes. */
export type LookupKeyType = "PB_KEY" | "GNAF_PID" | "UDPRN" | "UPRN" | "EIR_CODE";

/** A key to look up. */
export interface LookupKey {
  /** The key itself, such as `P0000GL41OME`. */
  key: string;
  /** The kind of key. */
  type: LookupKeyType;
  /** The country, as an ISO 3166-1 alpha-2 or alpha-3 code or a common name. */
  country: string;
}

// Request headers, carried as fields of the params

/** The header every operation accepts. */
export interface RequestHeaders {
  /** The caller's own ID for the request, 38 characters at most. Sent as the `X-Request-Id` header. */
  "X-Request-Id"?: string | undefined;
}

/** The headers of the type-ahead operations. */
export interface TransactionHeaders extends RequestHeaders {
  /**
   * A UUID that groups type-ahead calls into one billable transaction.
   * A transaction closes after 15 seconds or 12 calls. Sent as the `X-Transaction-Id` header.
   */
  "X-Transaction-Id"?: string | undefined;
}

// Real-time requests

/** The request of `POST /v1/geocode`. */
export interface GeocodeParams extends RequestHeaders {
  preferences?: Preferences | undefined;
  /** The addresses to geocode, 1 to 25 of them. */
  addresses: RequestAddressWithId[];
}

/** The request of `POST /v1/reverse-geocode`. */
export interface ReverseGeocodeParams extends RequestHeaders {
  /** `distance` is the search radius around each point. */
  preferences?: Preferences | undefined;
  /** The points to reverse geocode, 1 to 25 of them. */
  locations: LocationDetail[];
}

/** The request of `POST /v1/lookup`. */
export interface LookupParams extends RequestHeaders {
  preferences?: Preferences | undefined;
  /** The keys to look up, 1 to 25 of them. */
  keys: LookupKey[];
}

/** The request of `POST /v1/verify`. */
export interface VerifyParams extends RequestHeaders {
  preferences?: Preferences | undefined;
  /** The addresses to verify, 1 to 25 of them. */
  addresses: RequestAddressWithId[];
}

/** The request of `POST /v1/autocomplete` and `POST /v1/express-autocomplete`. */
export interface AutocompleteParams extends TransactionHeaders {
  preferences?: Preferences | undefined;
  /** The address typed so far. One address, not a list. */
  address: RequestAddress;
}

/** The request of `POST /v2/express-autocomplete`. */
export interface ExpressAutocompleteV2Params extends TransactionHeaders {
  preferences?: AutocompleteV2Preferences | undefined;
  /** The address typed so far. One address, not a list. */
  address: RequestAddress;
}

// Real-time responses

/** How one item of a request, or a whole request, ended. */
export type Status =
  | "OK"
  | "ZERO_RESULTS"
  | "UNKNOWN_ERROR"
  | "INVALID_REQUEST"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "INVALID_CLIENT_INPUT"
  | "INVALID_TOKEN"
  | "BATCH_SIZE_EXCEEDED"
  | "FORBIDDEN"
  | "TOO_MANY_REQUESTS"
  | "REQUEST_TIMEOUT";

/** A name in its long and its short form. An empty one comes as `{}`. */
export interface AdminField {
  /** The full name, such as `Massachusetts`. */
  longName?: string;
  /** The short name, such as `MA`. */
  shortName?: string;
}

/** A country and its codes. */
export interface CountryField {
  /** The country's name. */
  name?: string;
  /** The ISO 3166-1 alpha-2 code. */
  isoAlpha2Code?: string;
  /** The ISO 3166-1 alpha-3 code. */
  isoAlpha3Code?: string;
  /** The ISO 3166-1 numeric code, as a string such as `"840"`. */
  isoNumericCode?: string;
}

/** The address of a candidate. */
export interface ResponseAddress {
  /** The whole address on one line. */
  formattedAddress?: string;
  /** The street line. */
  formattedStreetAddress?: string;
  /** The line with the town, region and postal code. */
  formattedLocationAddress?: string;
  /** The house number. */
  addressNumber?: string;
  /** The street name. */
  street?: string;
  /** The postal code. */
  postalCode?: string;
  /** The extension of the postal code. */
  postalCodeExt?: string;
  /** The name of the place. */
  placeName?: string;
  /** The building. */
  building?: string;
  /** The floor. */
  floor?: string;
  /** The room. */
  room?: string;
  /** The unit, such as `300`. */
  unit?: string;
  /** The kind of unit, such as `STE`. */
  unitType?: string;
  /** The country. */
  country?: CountryField;
  /** The state or province. */
  admin1?: AdminField;
  /** The county or district. */
  admin2?: AdminField;
  /** The city or town. */
  city?: AdminField;
  /** The borough. */
  borough?: AdminField;
  /** The neighbourhood. */
  neighborhood?: AdminField;
  /** The suburb. */
  suburb?: AdminField;
}

/** What kind of point a location is. */
export type LocationType =
  | "ADDRESS_POINT"
  | "INTERSECTION"
  | "ADDRESS_INTERPOLATED"
  | "NEAR_BY_ADDRESS"
  | "STREET"
  | "STREET_CENTER"
  | "STREET_BLOCK"
  | "POSTAL"
  | "POSTAL_CENTROID"
  | "SUB_TOWN_CENTROID"
  | "TOWN_CENTROID"
  | "ADMIN1"
  | "ADMIN1_CENTROID"
  | "ADMIN2"
  | "ADMIN2_CENTROID"
  | "CITY"
  | "NEIGHBORHOOD"
  | "SUBURB"
  | "COUNTRY"
  | "UNKNOWN"
  | "NO_LOCATION"
  | "POI"
  | "POSTAL_BUILDING"
  | "PO_BOX";

/** What a location's point stands on. */
export type LocationDescriptionType =
  | "POSTAL_BUILDING"
  | "INTERSECTION"
  | "STREET_BLOCK"
  | "PO_BOX"
  | "PO_BLOCK"
  | "BUILDING"
  | "PROJECTED_POINT"
  | "POSTAL_CODE"
  | "POSTAL_CODE_EXT"
  | "POINT_OF_INTEREST"
  | "PARCEL"
  | "FRONT_DOOR"
  | "DRIVEWAY"
  | "STREET_ACCESS_POINT"
  | "PARCEL_POINT"
  | "BACKFILL_POINT"
  | "VIRTUAL_POINT"
  | "DOOR"
  | "ROOM"
  | "BACK_DOOR"
  | "BUILDING_ENTRANCE"
  | "EAST_SIDE_DOOR"
  | "WEST_SIDE_DOOR"
  | "SOUTH_SIDE_DOOR"
  | "NORTH_SIDE_DOOR"
  | "ENTRANCE"
  | "IOT_DEVICE";

/** How a location's point was placed. */
export type LocationDesignationType =
  | "CENTROID"
  | "CENTER_LINE_PROJECTED"
  | "MODIFIED_SEGMENT_WITH_POINT"
  | "CALCULATED_WITH_PARCEL_AND_CENTERLINE"
  | "RELATIVE_TO_STREET"
  | "RELATIVE_TO_MULTI_PARCEL"
  | "RELATIVE_TO_PARCEL_AND_STREET_CENTER"
  | "CALCULATED_WITH_STREET_SEGMENTS"
  | "INTERPOLATED_INTERSECTION"
  | "MIDPOINT_BETWEEN_RANGE"
  | "MULTIPLE_USPS_SEGMENTS"
  | "SEGMENT_WITHOUT_SHAPE"
  | "CALCULATED_WITH_USER_DATA"
  | "CALCULATED_WITH_POINT_AND_STREET"
  | "CALCULATED_WITH_TWO_STREET_SEGMENTS";

/** What a location's point is and how it was placed. */
export interface LocationExplanation {
  /** What kind of point it is. */
  type?: LocationType;
  /** What the point stands on. */
  description?: LocationDescriptionType;
  /** How the point was placed. */
  designation?: LocationDesignationType;
  /** More about the point, all strings, such as `{ SOURCE: "PRECISELY" }`. */
  additionalMetadata?: Record<string, string>;
}

/** The geometry of a location. Always a point. */
export interface PointGeometry {
  type: "Point";
  /** The point as x and y, which is longitude then latitude in the default coordinate system. */
  coordinates: [x: number, y: number];
  /** Members outside the GeoJSON standard, all strings. */
  foreignMembers?: Record<string, string>;
}

/** The feature that holds a location's point. */
export interface LocationFeature {
  type: "Feature";
  /** The feature's properties, all strings, such as `{ crsName: "epsg:4326" }`. */
  properties?: Record<string, string>;
  /** The point. */
  geometry: PointGeometry;
}

/** Where a candidate is. */
export interface Location {
  /** What the point is and how it was placed. */
  explanation?: LocationExplanation;
  /** The point, as a feature. */
  feature?: LocationFeature;
}

/** What kind of thing the input matched. */
export type MatchType = "ADDRESS" | "STREET" | "ADMIN" | "POBOX" | "POI" | "NOMATCH";

/** How one part of the input matched. */
export interface MatchDescription {
  /** The part of the address, such as `addressNumber`, `street`, `city` or `postalCode`. */
  label?: string;
  /** How well the part matched. */
  matchType?: "EXACT" | "PARTIAL" | "ALIAS_EXACT" | "ALIAS_PARTIAL" | "ADDED" | "REMOVED" | "NONE";
  /** Which form of the part the candidate carries. */
  returnType?: "INPUT" | "PREFERRED" | "ALIAS" | "PARTIAL" | "NONE";
  /** The piece of the input that matched. Autocomplete only. */
  matchedSubstring?: string;
}

/** How the input matched the candidate. */
export interface AddressMatch {
  /** What kind of thing the input matched. Reverse geocode and lookup leave it out. */
  type?: MatchType;
  /** How each part of the input matched. */
  description?: MatchDescription[];
}

/** How a candidate was found. */
export interface Explanation {
  /** The engine that answered, such as `Geocoder`. */
  identifier?: string;
  /** How the input matched the candidate. */
  addressMatch?: AddressMatch;
  /** The data the candidate came from, such as `{ label: "ggs" }`. */
  source?: Record<string, string>;
}

/** One piece of the parsed input. */
export interface Classification {
  /** Where the piece was read from. */
  from?: string;
  /** What the piece is, such as `street`. */
  label?: string;
  /** The piece itself. */
  value?: string;
  /** Where the piece starts in the input. */
  start?: number;
  /** Where the piece ends in the input. */
  end?: number;
}

/** One reading of the input, as its parts. */
export interface Parsed {
  /** How sure the reading is. */
  score?: number;
  /** The parts of the input. */
  classifications?: Classification[];
}

/** The elements of an ISO 20022 postal address. */
export interface Iso20022Elements {
  /** The street name. */
  StrtNm?: string;
  /** The building number. */
  BldgNb?: string;
  /** The building name. */
  BldgNm?: string;
  /** The unit number. */
  UnitNb?: string;
  /** The room. */
  Room?: string;
  /** The post box. */
  PstBx?: string;
  /** The post code. */
  PstCd?: string;
  /** The town name. */
  TwnNm?: string;
  /** The name of the place within the town. */
  TwnLctnNm?: string;
  /** The district name. */
  DstrctNm?: string;
  /** The subdivision of the country, such as a state. */
  CtrySubDvsn?: string;
  /** The country. */
  Ctry?: string;
}

/** A candidate's address in the ISO 20022 form. */
export interface Iso20022 {
  address?: {
    /** The message element, `PostalAddress27`. */
    type?: string;
    /** The form of the address, `STRUCTURED`. */
    format?: string;
    /** The elements of the address. */
    elements?: Iso20022Elements;
  };
}

/** One candidate. */
export interface Result {
  /** How much of the input matched, from 0 to 100. Reverse geocode and lookup answer 0. */
  score?: number;
  /** The candidate's address. */
  address?: ResponseAddress;
  /** The address as the lines of a postal label. */
  addressLines?: string[];
  /** Where the candidate is. Verify leaves it out. */
  location?: Location;
  /** How the candidate was found. */
  explanation?: Explanation;
  /** Attributes that depend on the data, all strings, such as `PB_KEY`, `MATCH_CODE` or `GEOHASH`. */
  customFields?: Record<string, string>;
  /** The input as it was parsed. */
  parsed?: Parsed[];
  /** The address in the ISO 20022 form. */
  iso20022?: Iso20022;
}

/** The answer to one item of a request. */
export interface ItemResponse {
  /** The item's `addressId`, echoed. Lookup has none. */
  addressId?: string;
  /** How the item ended. */
  status: Status;
  /** Why the item failed, ending with Precisely's error code in parentheses. */
  errorMessage?: string;
  /** The candidates, `maxResults` at most. A failed item has none. */
  results?: Result[];
}

/**
 * The answer of the batch operations, one entry per item and in the order sent.
 * The HTTP status is 200 when every item succeeded and 206 when one did not.
 */
export interface Responses {
  responses: ItemResponse[];
}

/** The answer of `POST /v1/geocode`. */
export type GeocodeResponse = Responses;
/** The answer of `POST /v1/reverse-geocode`. */
export type ReverseGeocodeResponse = Responses;
/** The answer of `POST /v1/lookup`. */
export type LookupResponse = Responses;
/** The answer of `POST /v1/verify`. */
export type VerifyResponse = Responses;

/** One prediction, which is a candidate with the text to show for it. */
export interface Prediction extends Result {
  /** The text to show, such as `350 Jordan Ave, Montoursville PA 17754`. */
  prediction?: string;
  /** How far the prediction is from the origin. */
  distance?: Distance;
}

/** The answer of the three autocomplete operations. */
export interface AutocompleteResponse {
  response: {
    /** How the request ended. */
    status: Status;
    /** Why the request failed. */
    errorMessage?: string;
    /** The predictions, best first. */
    predictions?: Prediction[];
  };
}

// Postal city, proximity search and address codes

/** What `POST /v1/autocomplete/postal-city` completes, a postal code or a town. */
export type PostalCityType = "POSTAL" | "CITY";

/** The text typed so far, and where. */
export interface PostalCityAddress {
  /** Whether `postAddress` is the start of a postal code or of a town's name. */
  type?: PostalCityType | undefined;
  /** The postal code or town typed so far, such as `12180`. */
  postAddress?: string | undefined;
  /** The country, as an ISO 3166-1 alpha-2 or alpha-3 code or a common name. */
  country: string;
}

/** The request of `POST /v1/autocomplete/postal-city`. */
export interface PostalCityParams extends RequestHeaders {
  preferences?: Preferences | undefined;
  address: PostalCityAddress;
}

/** One postal code or town, with the areas around it. */
export interface PostalCityPrediction {
  address?: {
    country?: CountryField;
    admin1?: AdminField;
    admin2?: AdminField;
    city?: AdminField;
    postalCode?: string;
  };
  /** Where it is. */
  location?: Location;
}

/** The answer of `POST /v1/autocomplete/postal-city`. */
export interface PostalCityResponse {
  response: {
    /** How the request ended. */
    status: Status;
    /** Why the request failed. */
    errorMessage?: string;
    /** The predictions, best first. */
    predictions?: PostalCityPrediction[];
  };
}

/** What `POST /v1/proximity-search` searches, and how far. */
export interface ProximityPreferences {
  /** The dataset to search, such as `premium-address-points`. Required. */
  dataset: string;
  /** The most results to answer. Default 1. */
  maxResults?: number | undefined;
  /** Options that depend on the dataset, all strings, such as `{ CLOSEST: "true" }`. */
  customPreferences?: Record<string, string> | undefined;
  /** How far from the point to search. The result's `distance` comes back in its unit. */
  distance?: Distance | undefined;
  /** How far over a border the search reaches, in kilometres. */
  borderBufferKm?: number | undefined;
  /** Whether to search the other datasets too. */
  crossDatasetSearch?: boolean | undefined;
  /** Whether to route the request to the dataset of the country. */
  autoRoute?: boolean | undefined;
  /** The coordinate system of the point, such as `EPSG:4326`. */
  clientCoordSystemName?: string | undefined;
}

/** The point to search around. */
export interface ProximityLocation {
  /** The caller's own ID for the point, echoed in the answer. */
  addressId?: string | undefined;
  longitude: number;
  latitude: number;
  /** The country, as an ISO 3166-1 alpha-2 or alpha-3 code or a common name. */
  country: string;
}

/** The request of `POST /v1/proximity-search`. */
export interface ProximitySearchParams extends RequestHeaders {
  preferences: ProximityPreferences;
  location: ProximityLocation;
}

/** One address near the point. */
export interface ProximityResult {
  /** How far it is from the point, in the unit of the request's `distance`. */
  distance?: number;
  location?: { latitude: number; longitude: number };
  /** The address's attributes, all strings, such as `FORMATTEDADDRESS`, `POSTALCODE` or `PBKEY`. */
  metadata?: Record<string, string>;
}

/** The answer of `POST /v1/proximity-search`. */
export interface ProximitySearchResponse {
  response: {
    /** The point's `addressId`, echoed. */
    addressId?: string;
    /** How the request ended. */
    status?: Status;
    /** Why the request failed. */
    errorMessage?: string;
    /** The addresses, nearest first. */
    results?: ProximityResult[];
  };
}

/** The code systems `POST /v1/explain-addresscode` reads. */
export type AddressCodeType =
  | "GlobalMatchCode"
  | "GlobalLocationCode"
  | "GlobalDeliveryIndicator"
  | "ForwardResultCode"
  | "ReverseResultCode";

/** The request of `POST /v1/explain-addresscode`. */
export interface ExplainAddressCodeParams extends RequestHeaders {
  /** The code system every code is in. */
  codeType: AddressCodeType;
  /** The codes to explain, 1 to 25 of them. */
  codes: { id?: string | undefined; code: string }[];
  responseOptions?: { includeOfficialDescription?: boolean | undefined } | undefined;
}

/** How one component of a Global Match Code matched. */
export interface ComponentMatchStatus {
  /** The component, such as `Street`. */
  label?: string;
  /** Its status, from 0 to 6. */
  value?: number;
  /** What the status means, such as `Verified without changes`. */
  meaning?: string;
}

/** The parts of a code, in words. Written here for the Global Match Code. */
export interface OfficialDescription {
  addressMatchStatus?: {
    /** The first segment, such as `V4`. */
    symbol?: string;
    /** `Verified`, `Multiple Matches` or `Unmatched`. */
    status?: string;
    /** From 1 to 4, how fine the verification went. */
    verificationLevel?: number;
    verificationLevelLabel?: string;
  };
  /** Each component in the code, by its letter. */
  componentMatchStatus?: Record<string, ComponentMatchStatus>;
  matchConfidence?: { value?: number; label?: string };
}

/** One code, explained or not. */
export interface ExplainedCode {
  /** The code's `id`, echoed. */
  id?: string;
  /** `OK` when the code was explained. */
  status: "OK" | "ERROR" | "INVALID_REQUEST";
  result?: {
    codeType?: string;
    /** The code in a sentence or two, such as `Address premise verified with high confidence.` */
    customerInsightSummary?: string;
    /** Only when `responseOptions.includeOfficialDescription` is set. */
    officialDescription?: OfficialDescription;
  };
  /** Why the code was not explained, ending with Precisely's error code in parentheses. */
  errorMessage?: string;
}

/** The answer of `POST /v1/explain-addresscode`. The HTTP status is 206 when a code was not explained. */
export interface ExplainAddressCodeResponse {
  responses: ExplainedCode[];
  /** Where the code systems are documented. */
  documentationLink?: string;
  /** When the answer was made, in ISO 8601. */
  generatedAt?: string;
}

// Authentication

/** The answer of `POST /auth/v2/token`. */
export interface TokenResponse {
  /** The token, sent as `Authorization: Bearer <access_token>`. */
  access_token: string;
  /** Always `Bearer`. */
  token_type: string;
  /** Seconds the token lasts. */
  expires_in: number;
  /** Always `default`. */
  scope: string;
}

/** The body of a failed token call. Read it from the `cause` of the error thrown. */
export interface OauthError {
  /** What went wrong. */
  error:
    | "invalid_request"
    | "invalid_scope"
    | "invalid_grant"
    | "server_error"
    | "unsupported_grant_type"
    | "temporarily_unavailable"
    | "access_denied";
  /** The reason, ending with Precisely's error code in parentheses. */
  error_description?: string;
}

// Errors

/** One entry of an error body. */
export interface ErrorDetail {
  /** What kind of failure it is, such as `INVALID_REQUEST` or `INVALID_TOKEN`. */
  status: string;
  /** The reason, ending with Precisely's error code in parentheses. */
  errorMessage?: string;
  /** The item the error is about. Geo Addressing only. */
  addressId?: string;
}

/** The body of a failed Geo Addressing or Bulk call. Read it from the `cause` of the error thrown. */
export interface ErrorResponse {
  errors: ErrorDetail[];
}

// Bulk Geo Addressing v2

/** The request of `POST /v2/files/upload-url`. */
export interface UploadUrlParams extends RequestHeaders {
  /** A name for the file. A letter first, then letters, digits and underscores. */
  fileName: string;
}

/** The answer of `POST /v2/files/upload-url`. */
export interface UploadUrlResponse {
  /** The file's ID, which a job is started with. */
  fileId: string;
  /** Where to `PUT` the file. The URL is signed and works for 10 minutes. */
  url: string;
  /** How long the URL works, in words. */
  message: string;
}

/** What `bulk.upload` sends. */
export interface UploadParams {
  /** The `url` of an {@link UploadUrlResponse}. */
  url: string;
  /**
   * The input file, as CSV or text in UTF-8.
   * Its first row names the columns, and `addressid`, `address` and `country` are required.
   */
  content: string | Blob | ArrayBuffer | Uint8Array;
  /** The `Content-Type` sent. The URL is signed for one, and the default `text/csv` is the one Precisely's own uploader sends. */
  contentType?: string | undefined;
}

/** The answer of `GET /v2/files`. */
export interface ListFilesResponse {
  /** The uploaded files. */
  results: {
    /** The file's ID. */
    fileId: string;
    /** The name the file was given. */
    fileName: string;
  }[];
}

/** The request of `DELETE /v2/files/{fileId}`. */
export interface DeleteFileParams extends RequestHeaders {
  /** The file to delete. */
  fileId: string;
}

/** The answer of `DELETE /v2/files/{fileId}`. */
export interface DeleteFileResponse {
  /** `SUCCESS` when the file is gone. */
  status: string;
  /** The same in words. */
  message: string;
}

/** The header of a CASS report. All of it is text. */
export interface ReportDetails {
  /** Who processed the list. */
  listProcessorName?: string | undefined;
  /** The name or ID of the list. */
  listNameId?: string | undefined;
  /** How many lists there are. */
  totalList?: string | undefined;
  /** The mailer's address. */
  mailingAddress?: string | undefined;
  /** The post number. */
  postNumber?: string | undefined;
}

/** The request of `POST /v2/bulk-geocode` and `POST /v2/bulk-verify`. */
export interface BulkJobParams extends RequestHeaders {
  /**
   * Empty or absent for the normal flow, or `with_report` or `no_report` for the CASS flow.
   * Sent as the `X-CASS-FLOW` header.
   */
  "X-CASS-FLOW"?: "" | "with_report" | "no_report" | undefined;
  /** The `fileId` of an {@link UploadUrlResponse}, once the file is uploaded. */
  fileId: string;
  /** What separates the fields of the file. Default `|`. */
  delimiter?: "," | ";" | "|" | "\t" | undefined;
  /** The same preferences as the real-time operations take. */
  preferences?: Preferences | undefined;
  /** The header of the CASS report. */
  reportDetails?: ReportDetails | undefined;
  /** Who is mailed when the job completes or fails. Five addresses at most. */
  notifyEmails?: string[] | undefined;
}

/** The answer of `POST /v2/bulk-geocode` and `POST /v2/bulk-verify`, sent with HTTP 202. */
export interface BulkJobResponse {
  /** Where the job's state is read. The job's ID is the last segment of its path. */
  statusUrl: string;
  /** Set when the job was not accepted, such as `REJECTED`. */
  status?: string | null;
  /** Why the job was not accepted, such as `Queue full`. */
  message?: string | null;
}

/** The state of a job. `CANCELED` is spelled with one L. */
export type JobState = "SCHEDULED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED" | "REJECTED";

/** The request of `GET /v2/bulk/jobs/{jobId}` and `DELETE /v2/bulk/jobs/{jobId}`. */
export interface JobParams extends RequestHeaders {
  /** The job's ID, which is the last path segment of the `statusUrl` its submission answered. */
  jobId: string;
}

/** The answer of `GET /v2/bulk/jobs/{jobId}`. */
export interface JobStatusResponse {
  /** The state of the job. */
  status: JobState;
  /** Where the output file is, once the job is `COMPLETED`. The URL is signed and works for 10 minutes. */
  downloadUrl?: string;
  /** Where the CASS report is. The URL is signed too. */
  reportUrl?: string;
  /** How long the URLs work, in words. */
  message?: string;
  /** Why the job failed. */
  error?: string;
}

/** The request of `GET /v2/bulk/jobs`. */
export interface ListJobsParams extends RequestHeaders {
  /** Which jobs to list. Default `all`. */
  status?: "scheduled" | "running" | "all" | undefined;
}

/** A job that waits or runs. */
export interface QueuedJob {
  /** The job's ID. */
  jobId: string;
  /** The email of the user who started the job. */
  emailId?: string;
  /** The file the job reads. */
  fileId: string;
  /** The name that file was given. */
  fileName: string;
  /** `SCHEDULED` or `RUNNING`. */
  status: JobState;
  /** When the job was submitted, as an ISO 8601 time. */
  submittedAt: string;
}

/** The answer of `GET /v2/bulk/jobs`. Only jobs that wait or run are listed. */
export interface ListJobsResponse {
  jobs: QueuedJob[];
}

/** The answer of `DELETE /v2/bulk/jobs/{jobId}`. */
export interface CancelJobResponse {
  /** The job that is being cancelled. */
  jobId: string;
  /** What was done, in words. */
  message: string;
}

/** What `bulk.results` reads. */
export interface ResultsParams {
  /** The `downloadUrl` of a {@link JobStatusResponse}. */
  downloadUrl: string;
}
