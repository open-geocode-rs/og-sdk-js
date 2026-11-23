/**
 * The requests and responses of Places API (New) v1 and Geocoding API v4, as they are on the wire.
 *
 * Responses follow the proto3 JSON mapping. A field with no value is left out, never sent as `null`,
 * and a number that is zero or a boolean that is false is left out too unless the field tracks presence.
 * So every response field is optional, and a missing number reads as zero.
 */

// Shared request types.

/** A point, as a request sends it. WGS84. */
export interface LatLng {
  /** Degrees north, within [-90, 90]. */
  latitude: number;
  /** Degrees east, within [-180, 180]. */
  longitude: number;
}

/** A box, as a request sends it. It includes its boundary. */
export interface Viewport {
  /** The south-west corner. */
  low: LatLng;
  /** The north-east corner. A longitude west of `low` crosses the antimeridian. */
  high: LatLng;
}

/** A circle, as a request sends it. */
export interface Circle {
  /** The middle of the circle. */
  center: LatLng;
  /** Meters, within [0, 50000]. */
  radius: number;
}

/** A postal address, in a request and in a response. */
export interface PostalAddress {
  /** The schema revision. It is always 0. */
  revision?: number | undefined;
  /** The CLDR region code, such as `MC`. Responses send it in upper case. */
  regionCode?: string | undefined;
  /** The BCP-47 language of the address. */
  languageCode?: string | undefined;
  /** The postal code. */
  postalCode?: string | undefined;
  /** A sorting code, where the country uses one. */
  sortingCode?: string | undefined;
  /** The highest subdivision used in postal addresses, such as a state or a province. */
  administrativeArea?: string | undefined;
  /** The city or town. */
  locality?: string | undefined;
  /** A neighbourhood, borough or district. */
  sublocality?: string | undefined;
  /** The lines of the address, in the order they are written on an envelope. */
  addressLines?: readonly string[] | undefined;
  /** The recipients at the address. */
  recipients?: readonly string[] | undefined;
  /** The organisation at the address. */
  organization?: string | undefined;
}

/** How a route is travelled, in `routingParameters`. */
export type RoutingTravelMode =
  | "TRAVEL_MODE_UNSPECIFIED"
  | "DRIVE"
  | "BICYCLE"
  | "WALK"
  | "TWO_WHEELER";

/** How a route is computed. */
export type RoutingPreference =
  | "ROUTING_PREFERENCE_UNSPECIFIED"
  | "TRAFFIC_UNAWARE"
  | "TRAFFIC_AWARE"
  | "TRAFFIC_AWARE_OPTIMAL";

/** What a route should keep away from. */
export interface RouteModifiers {
  /** Keeps away from toll roads where reasonable. */
  avoidTolls?: boolean | undefined;
  /** Keeps away from highways where reasonable. */
  avoidHighways?: boolean | undefined;
  /** Keeps away from ferries where reasonable. */
  avoidFerries?: boolean | undefined;
  /** Keeps away from indoor paths where reasonable. */
  avoidIndoor?: boolean | undefined;
}

/** Asks for the travel time and distance from a point to each place found. */
export interface RoutingParameters {
  /** Where the routes start. */
  origin?: LatLng | undefined;
  /** How the routes are travelled. Unset means `DRIVE`. */
  travelMode?: RoutingTravelMode | undefined;
  /** What the routes keep away from. */
  routeModifiers?: RouteModifiers | undefined;
  /** How the routes are computed. */
  routingPreference?: RoutingPreference | undefined;
}

// Shared response types.

/** A point in a response. A coordinate that is exactly zero is left out. */
export interface ResponseLatLng {
  /** Degrees north. Absent means 0. */
  latitude?: number;
  /** Degrees east. Absent means 0. */
  longitude?: number;
}

/** A box in a response. */
export interface ResponseViewport {
  /** The south-west corner. */
  low?: ResponseLatLng;
  /** The north-east corner. */
  high?: ResponseLatLng;
}

/** A text in one language. */
export interface LocalizedText {
  /** The text. */
  text?: string;
  /** The BCP-47 language of the text. */
  languageCode?: string;
}

/** A Plus Code. */
export interface PlusCode {
  /** The full code, such as `9FWM33GV+HQ`. */
  globalCode?: string;
  /** The short code with a locality, such as `33GV+HQ, Ramberg, Norway`. */
  compoundCode?: string;
}

/** One part of an address. */
export interface AddressComponent {
  /** The full text of the part. */
  longText?: string;
  /** The abbreviated text of the part, where there is one. */
  shortText?: string;
  /** What the part is, such as `route` or `locality`. */
  types?: string[];
  /** The language of the text. Left out on numeric parts. */
  languageCode?: string;
}

/** A calendar date. A part that is zero is not set. */
export interface DateValue {
  /** The year, or absent for a date without a year. */
  year?: number;
  /** The month, 1 to 12. */
  month?: number;
  /** The day of the month, 1 to 31. */
  day?: number;
}

/** An amount of money. */
export interface Money {
  /** The ISO 4217 currency code. */
  currencyCode?: string;
  /** The whole units. An int64, so it is sent as a string. */
  units?: string;
  /** Billionths of a unit. */
  nanos?: number;
}

// The Place resource.

/** Whether a business is running. */
export type BusinessStatus =
  | "BUSINESS_STATUS_UNSPECIFIED"
  | "OPERATIONAL"
  | "CLOSED_TEMPORARILY"
  | "CLOSED_PERMANENTLY"
  | "FUTURE_OPENING";

/** How expensive a place is. */
export type PriceLevel =
  | "PRICE_LEVEL_UNSPECIFIED"
  | "PRICE_LEVEL_FREE"
  | "PRICE_LEVEL_INEXPENSIVE"
  | "PRICE_LEVEL_MODERATE"
  | "PRICE_LEVEL_EXPENSIVE"
  | "PRICE_LEVEL_VERY_EXPENSIVE";

/** What a set of secondary opening hours is for. */
export type SecondaryHoursType =
  | "SECONDARY_HOURS_TYPE_UNSPECIFIED"
  | "DRIVE_THROUGH"
  | "HAPPY_HOUR"
  | "DELIVERY"
  | "TAKEOUT"
  | "KITCHEN"
  | "BREAKFAST"
  | "LUNCH"
  | "DINNER"
  | "BRUNCH"
  | "PICKUP"
  | "ACCESS"
  | "SENIOR_HOURS"
  | "ONLINE_SERVICE_HOURS";

/** How a landmark lies to the place. `NEAR` is the default and is left out on the wire. */
export type SpatialRelationship =
  | "NEAR"
  | "WITHIN"
  | "BESIDE"
  | "ACROSS_THE_ROAD"
  | "DOWN_THE_ROAD"
  | "AROUND_THE_CORNER"
  | "BEHIND";

/** How an area holds the place. */
export type Containment = "CONTAINMENT_UNSPECIFIED" | "WITHIN" | "OUTSKIRTS" | "NEAR";

/** A kind of EV charging connector. */
export type EVConnectorType =
  | "EV_CONNECTOR_TYPE_UNSPECIFIED"
  | "EV_CONNECTOR_TYPE_OTHER"
  | "EV_CONNECTOR_TYPE_J1772"
  | "EV_CONNECTOR_TYPE_TYPE_2"
  | "EV_CONNECTOR_TYPE_CHADEMO"
  | "EV_CONNECTOR_TYPE_CCS_COMBO_1"
  | "EV_CONNECTOR_TYPE_CCS_COMBO_2"
  | "EV_CONNECTOR_TYPE_TESLA"
  | "EV_CONNECTOR_TYPE_UNSPECIFIED_GB_T"
  | "EV_CONNECTOR_TYPE_UNSPECIFIED_WALL_OUTLET"
  | "EV_CONNECTOR_TYPE_NACS";

/** A kind of fuel. */
export type FuelType =
  | "FUEL_TYPE_UNSPECIFIED"
  | "DIESEL"
  | "DIESEL_PLUS"
  | "REGULAR_UNLEADED"
  | "MIDGRADE"
  | "PREMIUM"
  | "SP91"
  | "SP91_E10"
  | "SP92"
  | "SP95"
  | "SP95_E10"
  | "SP98"
  | "SP99"
  | "SP100"
  | "LPG"
  | "E80"
  | "E85"
  | "E100"
  | "METHANE"
  | "BIO_DIESEL"
  | "TRUCK_DIESEL";

/** A kind of transit vehicle. */
export type VehicleType =
  | "VEHICLE_TYPE_UNSPECIFIED"
  | "RAIL"
  | "METRO_RAIL"
  | "SUBWAY"
  | "TRAM"
  | "MONORAIL"
  | "HEAVY_RAIL"
  | "COMMUTER_TRAIN"
  | "HIGH_SPEED_TRAIN"
  | "LONG_DISTANCE_TRAIN"
  | "BUS"
  | "INTERCITY_BUS"
  | "TROLLEYBUS"
  | "SHARE_TAXI"
  | "COACH"
  | "FERRY"
  | "CABLE_CAR"
  | "GONDOLA_LIFT"
  | "FUNICULAR"
  | "SPECIAL"
  | "HORSE_CARRIAGE"
  | "AIRPLANE";

/** How a navigation point of a place is reached. */
export type NavigationTravelMode = "TRAVEL_MODE_UNSPECIFIED" | "DRIVE" | "WALK";

/** What a navigation point is for. */
export type NavigationUsage = "USAGE_UNSPECIFIED" | "DROPOFF" | "PICKUP" | "PARKING";

/** A mark on an entrance. */
export type EntranceTag = "TAG_UNSPECIFIED" | "PREFERRED";

/** Who wrote a review or took a photo. */
export interface AuthorAttribution {
  /** The author's name. */
  displayName?: string;
  /** A link to the author's profile. */
  uri?: string;
  /** A link to the author's profile photo. */
  photoUri?: string;
}

/** A review of a place. */
export interface Review {
  /** The resource name, `places/{placeId}/reviews/{review}`. */
  name?: string;
  /** How long ago the review was written, in words, such as `a month ago`. */
  relativePublishTimeDescription?: string;
  /** The review, translated to the request language where it could be. */
  text?: LocalizedText;
  /** The review in the language it was written in. */
  originalText?: LocalizedText;
  /** Stars, 1 to 5. */
  rating?: number;
  /** Who wrote the review. */
  authorAttribution?: AuthorAttribution;
  /** When the review was written, as an RFC 3339 timestamp. */
  publishTime?: string;
  /** A link to report the review. */
  flagContentUri?: string;
  /** A link to the review on Google Maps. */
  googleMapsUri?: string;
  /** When the author visited, to the month. */
  visitDate?: DateValue;
}

/** A photo of a place. */
export interface Photo {
  /** The resource name, `places/{placeId}/photos/{photo_reference}`. */
  name?: string;
  /** The largest width available, in pixels. */
  widthPx?: number;
  /** The largest height available, in pixels. */
  heightPx?: number;
  /** Who took the photo. Always present, though it may be empty. */
  authorAttributions?: AuthorAttribution[];
  /** A link to report the photo. */
  flagContentUri?: string;
  /** A link to the photo on Google Maps. */
  googleMapsUri?: string;
}

/** A moment a place opens or closes. */
export interface OpeningHoursPoint {
  /** The date, in the place's time zone. Set on current hours only. */
  date?: DateValue;
  /** Whether the real moment lies outside the seven days covered and was cut to their edge. */
  truncated?: boolean;
  /** The day of the week, 0 for Sunday to 6 for Saturday. */
  day?: number;
  /** The hour, 0 to 23. */
  hour?: number;
  /** The minute, 0 to 59. */
  minute?: number;
}

/** A stretch of time a place is open. */
export interface OpeningHoursPeriod {
  /** When the place opens. */
  open?: OpeningHoursPoint;
  /** When the place closes. Absent for a place that never closes. */
  close?: OpeningHoursPoint;
}

/** A day with hours that differ from the usual ones. */
export interface SpecialDay {
  /** The day. */
  date?: DateValue;
}

/** When a place is open. */
export interface OpeningHours {
  /** The open periods, in time order. Present but empty for a place that is never open. */
  periods?: OpeningHoursPeriod[];
  /** One line of text per day of the week, in the request language. */
  weekdayDescriptions?: string[];
  /** What the hours are for, on secondary hours. */
  secondaryHoursType?: SecondaryHoursType;
  /** The days in the period covered whose hours differ from the usual ones. */
  specialDays?: SpecialDay[];
  /** When the place next opens, up to seven days ahead, as an RFC 3339 timestamp. */
  nextOpenTime?: string;
  /** When the place next closes, up to seven days ahead, as an RFC 3339 timestamp. */
  nextCloseTime?: string;
  /** Whether the place is open now. Absent when unknown. */
  openNow?: boolean;
}

/** A data provider that must be shown with a place. */
export interface Attribution {
  /** The provider's name. */
  provider?: string;
  /** A link to the provider. */
  providerUri?: string;
}

/** An IANA time zone. */
export interface TimeZone {
  /** The zone's name, such as `Europe/Monaco`. */
  id?: string;
  /** The version of the time zone database, such as `2024a`. */
  version?: string;
}

/** How a place can be paid. A field is absent when unknown. */
export interface PaymentOptions {
  /** Takes credit cards. */
  acceptsCreditCards?: boolean;
  /** Takes debit cards. */
  acceptsDebitCards?: boolean;
  /** Takes cash only. */
  acceptsCashOnly?: boolean;
  /** Takes contactless payments. */
  acceptsNfc?: boolean;
}

/** Where to park at a place. A field is absent when unknown. */
export interface ParkingOptions {
  /** Has free parking lots. */
  freeParkingLot?: boolean;
  /** Has paid parking lots. */
  paidParkingLot?: boolean;
  /** Has free street parking. */
  freeStreetParking?: boolean;
  /** Has paid street parking. */
  paidStreetParking?: boolean;
  /** Has valet parking. */
  valetParking?: boolean;
  /** Has free garage parking. */
  freeGarageParking?: boolean;
  /** Has paid garage parking. */
  paidGarageParking?: boolean;
}

/** A reference to another place. */
export interface PlaceReference {
  /** The resource name, `places/{placeId}`. */
  name?: string;
  /** The place ID. */
  id?: string;
}

/** The price of one fuel. */
export interface FuelPrice {
  /** The fuel. */
  type?: FuelType;
  /** The price. */
  price?: Money;
  /** When the price was last updated, as an RFC 3339 timestamp. */
  updateTime?: string;
}

/** The fuels a station sells. */
export interface FuelOptions {
  /** The last known price of each fuel, one entry per fuel. */
  fuelPrices?: FuelPrice[];
}

/** The connectors of one type and charge rate at a station. */
export interface ConnectorAggregation {
  /** The connector type. */
  type?: EVConnectorType;
  /** The highest charge rate of each connector, in kilowatts. */
  maxChargeRateKw?: number;
  /** How many connectors there are. */
  count?: number;
  /** When the availability was last updated, as an RFC 3339 timestamp. */
  availabilityLastUpdateTime?: string;
  /** How many connectors are free now. */
  availableCount?: number;
  /** How many connectors are out of service now. */
  outOfServiceCount?: number;
}

/** The EV charging a station offers. */
export interface EVChargeOptions {
  /** How many connectors the station has. */
  connectorCount?: number;
  /** The connectors, grouped by type and charge rate. */
  connectorAggregation?: ConnectorAggregation[];
}

/** A summary of a place written by a model. */
export interface GenerativeSummary {
  /** The overview. */
  overview?: LocalizedText;
  /** A link to report the overview. */
  overviewFlagContentUri?: string;
  /** The notice that says the text was written by a model. */
  disclosureText?: LocalizedText;
}

/** A landmark near a place. */
export interface Landmark {
  /** The landmark's resource name. */
  name?: string;
  /** The landmark's place ID. */
  placeId?: string;
  /** The landmark's name. */
  displayName?: LocalizedText;
  /** What the landmark is. */
  types?: string[];
  /** How the landmark lies to the place. Absent means `NEAR`. */
  spatialRelationship?: SpatialRelationship;
  /** Meters between the two in a straight line. */
  straightLineDistanceMeters?: number;
  /** Meters between the two along the road network, where known. */
  travelDistanceMeters?: number;
}

/** An area a place lies in or near. */
export interface Area {
  /** The area's resource name. */
  name?: string;
  /** The area's place ID. */
  placeId?: string;
  /** The area's name. */
  displayName?: LocalizedText;
  /** How the area holds the place. */
  containment?: Containment;
}

/** Where a place is, told by what is around it. */
export interface AddressDescriptor {
  /** Nearby landmarks, the most recognisable and closest first. */
  landmarks?: Landmark[];
  /** Areas that hold the place or lie next to it, the smallest first. */
  areas?: Area[];
}

/** Links that open Google Maps on a place. */
export interface GoogleMapsLinks {
  /** Directions to the place. */
  directionsUri?: string;
  /** The place itself. */
  placeUri?: string;
  /** The form to write a review. */
  writeAReviewUri?: string;
  /** The place's reviews. */
  reviewsUri?: string;
  /** The place's photos. */
  photosUri?: string;
}

/** What a place usually costs. */
export interface PriceRange {
  /** The low end. */
  startPrice?: Money;
  /** The high end. Absent means there is no upper bound. */
  endPrice?: Money;
}

/** A summary of a place's reviews written by a model. */
export interface ReviewSummary {
  /** The summary. */
  text?: LocalizedText;
  /** A link to report the summary. */
  flagContentUri?: string;
  /** The notice that says the text was written by a model. */
  disclosureText?: LocalizedText;
  /** A link to the place's reviews. */
  reviewsUri?: string;
}

/** A piece of written content with the places it speaks of. */
export interface ContentBlock {
  /** The content. */
  content?: LocalizedText;
  /** The resource names of the places the content speaks of. */
  referencedPlaces?: string[];
}

/** A summary of what is near an EV charging station. */
export interface EvChargeAmenitySummary {
  /** An overview of what is near. */
  overview?: ContentBlock;
  /** The coffee places near. */
  coffee?: ContentBlock;
  /** The restaurants near. */
  restaurant?: ContentBlock;
  /** The shops near. */
  store?: ContentBlock;
  /** A link to report the summary. */
  flagContentUri?: string;
  /** The notice that says the text was written by a model. */
  disclosureText?: LocalizedText;
}

/** A summary of the points of interest near a place. */
export interface NeighborhoodSummary {
  /** An overview of the neighbourhood. */
  overview?: ContentBlock;
  /** A longer description of the neighbourhood. */
  description?: ContentBlock;
  /** A link to report the summary. */
  flagContentUri?: string;
  /** The notice that says the text was written by a model. */
  disclosureText?: LocalizedText;
}

/** A link with a title. */
export interface ConsumerAlertLink {
  /** The text to show for the link. */
  title?: string;
  /** The address of the link. */
  uri?: string;
}

/** The body of a consumer alert. */
export interface ConsumerAlertDetails {
  /** The alert's title. */
  title?: string;
  /** The alert's text. */
  description?: string;
  /** A link that explains the alert. */
  aboutLink?: ConsumerAlertLink;
}

/** A warning shown when a place's reviews look tampered with. */
export interface ConsumerAlert {
  /** The warning in short. */
  overview?: string;
  /** The warning in full. */
  details?: ConsumerAlertDetails;
  /** The language of the warning. */
  languageCode?: string;
}

/** An icon of a transit system, line or vehicle. */
export interface TransitIcon {
  /** The address of the icon. */
  url?: string;
  /** Whether the icon holds the name, so the name need not be shown beside it. */
  nameIncluded?: boolean;
}

/** A transit line. */
export interface TransitLine {
  /** An ID for the line within its station. It may change between responses. */
  id?: string;
  /** The kind of vehicle on the line. */
  vehicleType?: VehicleType;
  /** The line's long name. */
  displayName?: LocalizedText;
  /** The line's short name. */
  shortDisplayName?: LocalizedText;
  /** The colour of the line's label text, as `#RRGGBB`. */
  textColor?: string;
  /** The colour behind the line's label, as `#RRGGBB`. */
  backgroundColor?: string;
  /** A page about the line. */
  url?: string;
  /** The line's own icon. */
  icon?: TransitIcon;
  /** The icon of the line's vehicle type. */
  vehicleIcon?: TransitIcon;
}

/** A transit agency. */
export interface TransitAgency {
  /** The agency's name. */
  displayName?: LocalizedText;
  /** The agency's home page. */
  url?: string;
  /** The agency's page about fares. */
  fareUrl?: string;
  /** The transit system's branded icon, to show in place of a line's vehicle icon. */
  icon?: TransitIcon;
  /** The lines the agency runs at the station. */
  lines?: TransitLine[];
}

/** A stop or platform of a transit station. */
export interface TransitStop {
  /** An ID for the stop within its station. It may change between responses. */
  id?: string;
  /** The stop's name. */
  displayName?: LocalizedText;
  /** The platform, in whatever form it is written, such as `2` or `Platform 2`. */
  platformCode?: LocalizedText;
  /** The text on the platform's signboard. */
  signageText?: LocalizedText;
  /** The code agencies tell stops of the same name apart by. */
  stopCode?: LocalizedText;
  /** Where the stop is. */
  location?: ResponseLatLng;
  /** Whether a wheelchair can get from outside the station to the stop. */
  wheelchairAccessibleEntrance?: boolean;
}

/** What a place is as a transit station. */
export interface TransitStation {
  /** The station's name in the local language. */
  displayName?: LocalizedText;
  /** The agencies that serve the station. */
  agencies?: TransitAgency[];
  /** The stops at the station. */
  stops?: TransitStop[];
}

/** A way into a place. */
export interface Entrance {
  /** Where the entrance is. */
  location?: ResponseLatLng;
  /** Marks on the entrance. Left out when there are none. */
  tags?: EntranceTag[];
}

/** A point on the road network from which a place is reached. */
export interface NavigationPoint {
  /** A token that names the point to other Google services. */
  navigationPointToken?: string;
  /** The point's name. */
  displayName?: LocalizedText;
  /** Where the point is. */
  location?: ResponseLatLng;
  /** How the point can be reached. */
  travelModes?: NavigationTravelMode[];
  /** What the point is for. */
  usages?: NavigationUsage[];
}

/** What a place offers people with a wheelchair. A field is absent when unknown. */
export interface AccessibilityOptions {
  /** Has parking a wheelchair can use. */
  wheelchairAccessibleParking?: boolean;
  /** Has an entrance a wheelchair can use. */
  wheelchairAccessibleEntrance?: boolean;
  /** Has a restroom a wheelchair can use. */
  wheelchairAccessibleRestroom?: boolean;
  /** Has seating a wheelchair can use. */
  wheelchairAccessibleSeating?: boolean;
}

/** A place. A field is present only when the field mask asks for it and it has a value. */
export interface Place {
  /** The resource name, `places/{placeId}`. */
  name?: string;
  /** The place ID. */
  id?: string;
  /** The place's name. */
  displayName?: LocalizedText;
  /** What the place is, as type tags. */
  types?: string[];
  /** The place's main type, one of `types`. Absent when the main type is not a supported one. */
  primaryType?: string;
  /** The main type in words, in the request language. */
  primaryTypeDisplayName?: LocalizedText;
  /** The type label the place has on Google Maps. */
  googleMapsTypeLabel?: LocalizedText;
  /** The phone number in national format. */
  nationalPhoneNumber?: string;
  /** The phone number in international format. */
  internationalPhoneNumber?: string;
  /** The full address. The country is left out when it matches the request's `regionCode`. */
  formattedAddress?: string;
  /** A short address, never with the country. */
  shortFormattedAddress?: string;
  /** The address in postal form. */
  postalAddress?: PostalAddress;
  /** The parts of the address. */
  addressComponents?: AddressComponent[];
  /** The Plus Code of the place's position. */
  plusCode?: PlusCode;
  /** Where the place is. */
  location?: ResponseLatLng;
  /** A box that shows the place well on a map. It is not the place's boundary. */
  viewport?: ResponseViewport;
  /** The average of the place's reviews, 1.0 to 5.0. */
  rating?: number;
  /** A link to the place on Google Maps. */
  googleMapsUri?: string;
  /** The place's own website. */
  websiteUri?: string;
  /** Reviews of the place, the most relevant first. At most 5. */
  reviews?: Review[];
  /** Photos of the place. At most 10. */
  photos?: Photo[];
  /** The address in adr microformat. */
  adrFormatAddress?: string;
  /** Whether the business is running. */
  businessStatus?: BusinessStatus;
  /** When the place will open. Only with `businessStatus` `FUTURE_OPENING`. */
  openingDate?: DateValue;
  /** How expensive the place is. */
  priceLevel?: PriceLevel;
  /** The data providers that must be shown with the place. */
  attributions?: Attribution[];
  /** The start of an icon address. Append `.svg` or `.png`. */
  iconMaskBaseUri?: string;
  /** The colour behind the icon, in hex, such as `#909CE1`. */
  iconBackgroundColor?: string;
  /** The hours for the next seven days, with special days. */
  currentOpeningHours?: OpeningHours;
  /** The usual hours. */
  regularOpeningHours?: OpeningHours;
  /** The secondary hours for the next seven days, such as drive-through or delivery. */
  currentSecondaryOpeningHours?: OpeningHours[];
  /** The usual secondary hours. */
  regularSecondaryOpeningHours?: OpeningHours[];
  /** The place's time zone. */
  timeZone?: TimeZone;
  /** A summary of the place. It must be shown unchanged. */
  editorialSummary?: LocalizedText;
  /** How the place can be paid. */
  paymentOptions?: PaymentOptions;
  /** Where to park at the place. */
  parkingOptions?: ParkingOptions;
  /** Places inside this one, such as the terminals of an airport. */
  subDestinations?: PlaceReference[];
  /** The fuels a station sells and their prices. */
  fuelOptions?: FuelOptions;
  /** The EV charging a station offers. */
  evChargeOptions?: EVChargeOptions;
  /** A summary of the place written by a model. */
  generativeSummary?: GenerativeSummary;
  /** The places this one lies in. */
  containingPlaces?: PlaceReference[];
  /** Where the place is, told by landmarks and areas. */
  addressDescriptor?: AddressDescriptor;
  /** Links that open Google Maps on the place. */
  googleMapsLinks?: GoogleMapsLinks;
  /** What the place usually costs. */
  priceRange?: PriceRange;
  /** A summary of the place's reviews written by a model. */
  reviewSummary?: ReviewSummary;
  /** What is near an EV charging station. */
  evChargeAmenitySummary?: EvChargeAmenitySummary;
  /** The points of interest near the place. */
  neighborhoodSummary?: NeighborhoodSummary;
  /** A warning shown when the place's reviews look tampered with. */
  consumerAlert?: ConsumerAlert;
  /** The resource name of the place this one moved to. */
  movedPlace?: string;
  /** The place ID of the place this one moved to. */
  movedPlaceId?: string;
  /** What the place is as a transit station. */
  transitStation?: TransitStation;
  /** The ways into the place. */
  entrances?: Entrance[];
  /** The points on the road network the place is reached from. */
  navigationPoints?: NavigationPoint[];
  /** How many reviews the place has. */
  userRatingCount?: number;
  /** Offers takeout. */
  takeout?: boolean;
  /** Delivers. */
  delivery?: boolean;
  /** Has seating, indoors or outdoors. */
  dineIn?: boolean;
  /** Offers curbside pickup. */
  curbsidePickup?: boolean;
  /** Takes reservations. */
  reservable?: boolean;
  /** Serves breakfast. */
  servesBreakfast?: boolean;
  /** Serves lunch. */
  servesLunch?: boolean;
  /** Serves dinner. */
  servesDinner?: boolean;
  /** Serves beer. */
  servesBeer?: boolean;
  /** Serves wine. */
  servesWine?: boolean;
  /** Serves brunch. */
  servesBrunch?: boolean;
  /** Serves vegetarian food. */
  servesVegetarianFood?: boolean;
  /** Minutes the place's time zone is ahead of UTC now. */
  utcOffsetMinutes?: number;
  /** Has outdoor seating. */
  outdoorSeating?: boolean;
  /** Has live music. */
  liveMusic?: boolean;
  /** Has a children's menu. */
  menuForChildren?: boolean;
  /** Serves cocktails. */
  servesCocktails?: boolean;
  /** Serves dessert. */
  servesDessert?: boolean;
  /** Serves coffee. */
  servesCoffee?: boolean;
  /** Is good for children. */
  goodForChildren?: boolean;
  /** Allows dogs. */
  allowsDogs?: boolean;
  /** Has a restroom. */
  restroom?: boolean;
  /** Has room for groups. */
  goodForGroups?: boolean;
  /** Is good for watching sports. */
  goodForWatchingSports?: boolean;
  /** What the place offers people with a wheelchair. */
  accessibilityOptions?: AccessibilityOptions;
  /** Whether the business only visits or delivers to its customers, with no address of its own to serve them at. */
  pureServiceAreaBusiness?: boolean;
}

// Field masks.

/** A path and every path under it. */
export type Under<Root extends string> = Root | `${Root}.${string}`;

/** A field of a {@link Place}, or a path under one, such as `displayName.text`. */
export type PlaceField = Under<keyof Place & string>;

/** A path of the Text Search response. `*` asks for every field. */
export type SearchTextField =
  | "*"
  | "places"
  | `places.${PlaceField}`
  | Under<"routingSummaries" | "contextualContents">
  | "nextPageToken"
  | "searchUri";

/** A path of the Nearby Search response. `*` asks for every field. */
export type SearchNearbyField = "*" | "places" | `places.${PlaceField}` | Under<"routingSummaries">;

/** A path of a place, with no `places.` in front. `*` asks for every field. */
export type PlaceDetailsField = "*" | PlaceField;

/** A path of the Autocomplete response, such as `suggestions.placePrediction.text.text`. */
export type AutocompleteField = "*" | Under<"suggestions">;

/** A field of a {@link GeocodeResult}, or a path under one. */
export type GeocodeResultField = Under<keyof GeocodeResult & string>;

/** A path of the address geocoding response, such as `results.placeId`. */
export type GeocodeAddressField = "*" | "results" | `results.${GeocodeResultField}`;

/** A path of the reverse geocoding response. */
export type GeocodeLocationField = GeocodeAddressField | Under<"plusCode">;

/** A path of a geocoding result, with no `results.` in front. */
export type GeocodePlaceField = "*" | GeocodeResultField;

// Text Search.

/** The order of Text Search results. */
export type SearchTextRankPreference = "RANK_PREFERENCE_UNSPECIFIED" | "DISTANCE" | "RELEVANCE";

/** An area to prefer results in. Set one of the two shapes. */
export interface LocationBias {
  /** A box. It cannot be wider than 180 degrees. */
  rectangle?: Viewport | undefined;
  /** A circle. */
  circle?: Circle | undefined;
}

/** A box results must lie in. */
export interface RectangleRestriction {
  /** The box. It cannot be wider than 180 degrees. */
  rectangle: Viewport;
}

/** A circle results must lie in. */
export interface CircleRestriction {
  /** The circle. */
  circle: Circle;
}

/** Filters for EV charging stations. */
export interface EVOptions {
  /** The lowest charging rate wanted, in kilowatts. */
  minimumChargingRateKw?: number | undefined;
  /** The connector types wanted. A place with none of them is left out. */
  connectorTypes?: readonly EVConnectorType[] | undefined;
}

/** A route as an encoded polyline. */
export interface Polyline {
  /** The polyline, in the encoded polyline format. */
  encodedPolyline: string;
}

/** Searches along a route. */
export interface SearchAlongRouteParameters {
  /** The route. */
  polyline: Polyline;
}

/** The request of `places.searchText`. */
export interface SearchTextParams {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Google refuses a request without one. */
  fieldMask: readonly SearchTextField[];
  /** The text to search for. */
  textQuery: string;
  /** The language of the results. Default `en`. */
  languageCode?: string | undefined;
  /** A two-letter CLDR region code. It formats addresses and can bias the results. */
  regionCode?: string | undefined;
  /** The order of the results. */
  rankPreference?: SearchTextRankPreference | undefined;
  /** One place type to prefer, or to keep to with `strictTypeFiltering`. */
  includedType?: string | undefined;
  /** Whether only places of `includedType` are returned. Default false. */
  strictTypeFiltering?: boolean | undefined;
  /** Whether only places open now are returned. Default false. */
  openNow?: boolean | undefined;
  /** The lowest average rating wanted, 0 to 5 in steps of 0.5. */
  minRating?: number | undefined;
  /** Results per page, 1 to 20. 0 or unset means 20. It wins over `maxResultCount`. */
  pageSize?: number | undefined;
  /**
   * The older name of `pageSize`.
   * @deprecated Use `pageSize`.
   */
  maxResultCount?: number | undefined;
  /** The `nextPageToken` of the page before. Every other parameter but the page size must stay the same. */
  pageToken?: string | undefined;
  /** The price levels wanted. `PRICE_LEVEL_FREE` is not allowed here. */
  priceLevels?: readonly PriceLevel[] | undefined;
  /** An area to prefer results in. Not with `locationRestriction`. */
  locationBias?: LocationBias | undefined;
  /** A box results must lie in. Not with `locationBias`. */
  locationRestriction?: RectangleRestriction | undefined;
  /** Filters for EV charging stations. */
  evOptions?: EVOptions | undefined;
  /** Asks for the travel time and distance to each place. */
  routingParameters?: RoutingParameters | undefined;
  /** Searches along a route. */
  searchAlongRouteParameters?: SearchAlongRouteParameters | undefined;
  /** Whether businesses with no address of their own to serve customers at are included. */
  includePureServiceAreaBusinesses?: boolean | undefined;
  /** Whether businesses that have not opened yet are included. Default false. */
  includeFutureOpeningBusinesses?: boolean | undefined;
}

/** One leg of a route. */
export interface RoutingLeg {
  /** The travel time, in seconds with an `s` at the end, such as `3.5s`. */
  duration?: string;
  /** The distance in meters. */
  distanceMeters?: number;
}

/** The route from the origin to one place. */
export interface RoutingSummary {
  /** The legs of the route. */
  legs?: RoutingLeg[];
  /** A link to directions on Google Maps. */
  directionsUri?: string;
}

/** A stretch of a text, in characters. */
export interface HighlightedTextRange {
  /** Where the stretch starts. */
  startIndex?: number;
  /** Where the stretch ends. */
  endIndex?: number;
}

/** A text with the stretches to highlight. */
export interface HighlightedText {
  /** The text. */
  text?: string;
  /** The stretches to highlight. */
  highlightedTextRanges?: HighlightedTextRange[];
}

/** A review that explains why a place was found. */
export interface ReviewJustification {
  /** The words of the review that match the query. */
  highlightedText?: HighlightedText;
  /** The review. */
  review?: Review;
}

/** Services of a business that explain why it was found. */
export interface BusinessAvailabilityAttributesJustification {
  /** Offers takeout. */
  takeout?: boolean;
  /** Delivers. */
  delivery?: boolean;
  /** Has seating. */
  dineIn?: boolean;
}

/** Why a place was found. One of the two fields is set. */
export interface Justification {
  /** A review that matches the query. */
  reviewJustification?: ReviewJustification;
  /** Services that match the query. */
  businessAvailabilityAttributesJustification?: BusinessAvailabilityAttributesJustification;
}

/** Content about a place chosen for the query. Experimental. */
export interface ContextualContent {
  /** Reviews chosen for the query. */
  reviews?: Review[];
  /** Photos chosen for the query. */
  photos?: Photo[];
  /** Why the place was found. */
  justifications?: Justification[];
}

/** The response of `places.searchText`. */
export interface SearchTextResponse {
  /** The places found. Left out when there are none. */
  places?: Place[];
  /** The route to each place, at the same index as `places`. An entry is empty when no route is known. */
  routingSummaries?: RoutingSummary[];
  /** Content about each place chosen for the query, at the same index as `places`. Experimental. */
  contextualContents?: ContextualContent[];
  /** The token for the next page. Absent or empty when there are no more pages. */
  nextPageToken?: string;
  /** A link that runs the same search on Google Maps. */
  searchUri?: string;
}

// Nearby Search.

/** The order of Nearby Search results. */
export type SearchNearbyRankPreference = "RANK_PREFERENCE_UNSPECIFIED" | "DISTANCE" | "POPULARITY";

/** The request of `places.searchNearby`. */
export interface SearchNearbyParams {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Google refuses a request without one. */
  fieldMask: readonly SearchNearbyField[];
  /** The circle to search in. Its radius must be more than 0. */
  locationRestriction: CircleRestriction;
  /** Up to 50 place types. A place must have at least one of them. */
  includedTypes?: readonly string[] | undefined;
  /** Up to 50 place types. A place must have none of them. */
  excludedTypes?: readonly string[] | undefined;
  /** Up to 50 place types. A place's main type must be one of them or a narrower one. */
  includedPrimaryTypes?: readonly string[] | undefined;
  /** Up to 50 place types. A place's main type must be none of them. */
  excludedPrimaryTypes?: readonly string[] | undefined;
  /** How many results to return, 1 to 20. Default 20. */
  maxResultCount?: number | undefined;
  /** The order of the results. Unset means `POPULARITY`. */
  rankPreference?: SearchNearbyRankPreference | undefined;
  /** The language of the results. Default `en`. */
  languageCode?: string | undefined;
  /** A two-letter CLDR region code. It formats addresses. */
  regionCode?: string | undefined;
  /** Asks for the travel time and distance to each place. */
  routingParameters?: RoutingParameters | undefined;
  /** Whether businesses that have not opened yet are included. Default false. */
  includeFutureOpeningBusinesses?: boolean | undefined;
}

/** The response of `places.searchNearby`. */
export interface SearchNearbyResponse {
  /** The places found. Left out when there are none. */
  places?: Place[];
  /** The route to each place, at the same index as `places`. */
  routingSummaries?: RoutingSummary[];
}

// Place Details.

/** The request of `places.get`. */
export interface GetPlaceParams {
  /** The place's resource name, `places/{placeId}`. It is the path of the request. */
  name: string;
  /** The response fields wanted, as paths of the place itself, sent as `X-Goog-FieldMask`. Google refuses a request without one. */
  fieldMask: readonly PlaceDetailsField[];
  /** The language of the result. Default `en`. */
  languageCode?: string | undefined;
  /** A two-letter CLDR region code. It formats the address. */
  regionCode?: string | undefined;
  /** The token of the autocomplete session this call ends. At most 36 URL-safe base64 characters. */
  sessionToken?: string | undefined;
}

// Autocomplete.

/** An area suggestions must lie in. Set one of the two shapes. */
export interface AutocompleteLocationRestriction {
  /** A box. */
  rectangle?: Viewport | undefined;
  /** A circle. A radius of 0 returns nothing. */
  circle?: Circle | undefined;
}

/** The request of `places.autocomplete`. */
export interface AutocompleteParams {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Every field is returned without one. */
  fieldMask?: readonly AutocompleteField[] | undefined;
  /** The text typed so far. */
  input: string;
  /** An area to prefer suggestions in. Not with `locationRestriction`. */
  locationBias?: LocationBias | undefined;
  /** An area suggestions must lie in. Not with `locationBias`. */
  locationRestriction?: AutocompleteLocationRestriction | undefined;
  /** Up to 5 place types, or `(regions)` or `(cities)` alone. */
  includedPrimaryTypes?: readonly string[] | undefined;
  /** Up to 15 two-letter region codes suggestions must lie in. With it, no query predictions are returned. */
  includedRegionCodes?: readonly string[] | undefined;
  /** The language of the suggestions. Default is the `Accept-Language` header, then `en`. */
  languageCode?: string | undefined;
  /** A two-letter region code. It biases and formats, and does not restrict. */
  regionCode?: string | undefined;
  /** A point to measure `distanceMeters` from. */
  origin?: LatLng | undefined;
  /** Where the cursor is in `input`, in Unicode characters from 0. Default is the end of `input`. */
  inputOffset?: number | undefined;
  /** Whether query predictions are returned beside place predictions. Default false. */
  includeQueryPredictions?: boolean | undefined;
  /** A token that groups the keystrokes of one search into a session. At most 36 URL-safe base64 characters. */
  sessionToken?: string | undefined;
  /** Whether businesses with no address of their own to serve customers at are included. Default false. */
  includePureServiceAreaBusinesses?: boolean | undefined;
  /** Whether businesses that have not opened yet are included. Default false. */
  includeFutureOpeningBusinesses?: boolean | undefined;
}

/** A stretch of a text, in Unicode characters. */
export interface StringRange {
  /** Where the stretch starts, counted from 0. Absent means 0. */
  startOffset?: number;
  /** Where the stretch ends. The character at this offset is not part of it. */
  endOffset?: number;
}

/** A text with the stretches that match the input. */
export interface FormattableText {
  /** The text. */
  text?: string;
  /** The stretches that match the input, in rising order. Left out when nothing matches. */
  matches?: StringRange[];
}

/** A suggestion split into a name and what tells it apart. */
export interface StructuredFormat {
  /** The name of the place, or the query. */
  mainText?: FormattableText;
  /** What tells the place apart, such as its city, or what narrows the query. */
  secondaryText?: FormattableText;
}

/** A place suggested for the input. */
export interface PlacePrediction {
  /** The resource name, `places/{placeId}`. */
  place?: string;
  /** The place ID. */
  placeId?: string;
  /** The suggestion on one line, usually the name and the address. */
  text?: FormattableText;
  /** The suggestion split into a name and what tells it apart. */
  structuredFormat?: StructuredFormat;
  /** What the place is. */
  types?: string[];
  /** Meters from `origin` in a straight line. Left out without `origin`, when 0, and for streets. */
  distanceMeters?: number;
}

/** A search query suggested for the input. */
export interface QueryPrediction {
  /** The query on one line. */
  text?: FormattableText;
  /** The query split into its main part and what narrows it. */
  structuredFormat?: StructuredFormat;
}

/** One suggestion. Exactly one of the two fields is set. */
export interface Suggestion {
  /** A place. */
  placePrediction?: PlacePrediction;
  /** A search query. */
  queryPrediction?: QueryPrediction;
}

/** The response of `places.autocomplete`. */
export interface AutocompleteResponse {
  /** At most 5 suggestions, the most relevant first. Left out when there are none. */
  suggestions?: Suggestion[];
}

// Geocoding.

/** How exact a geocoding result's position is. */
export type Granularity =
  | "GRANULARITY_UNSPECIFIED"
  | "ROOFTOP"
  | "RANGE_INTERPOLATED"
  | "GEOMETRIC_CENTER"
  | "APPROXIMATE";

/** How much work the geocoder puts into a request. */
export type Effort = "EFFORT_UNSPECIFIED" | "LOW" | "MEDIUM" | "HIGH";

/** One geocoding result. */
export interface GeocodeResult {
  /** The resource name. Google sends `//places.googleapis.com/places/{placeId}` here. */
  place?: string;
  /** The place ID. */
  placeId?: string;
  /** Where the result is. */
  location?: ResponseLatLng;
  /** How exact `location` is. */
  granularity?: Granularity;
  /** A box that shows the result well on a map. */
  viewport?: ResponseViewport;
  /** The box that holds the whole result. Sent for areas, left out for street addresses. */
  bounds?: ResponseViewport;
  /** The address on one line. */
  formattedAddress?: string;
  /** The address in postal form. */
  postalAddress?: PostalAddress;
  /** The parts of the address. */
  addressComponents?: AddressComponent[];
  /** Every locality in the postal code. Only on a result of type `postal_code`. */
  postalCodeLocalities?: LocalizedText[];
  /** What the result is, as type tags. */
  types?: string[];
  /** The Plus Code of `location`. Not always sent. */
  plusCode?: PlusCode;
}

/** A box to prefer geocoding results in. */
export interface GeocodeLocationBias {
  /** The box. */
  rectangle: Viewport;
}

/**
 * The request of `geocode.address`.
 * Give the address as `addressQuery` or as `address`, not both.
 */
export interface GeocodeAddressParams {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Every field is returned without one. */
  fieldMask?: readonly GeocodeAddressField[] | undefined;
  /** The address as one text, or a Plus Code. It is the last part of the request's path. */
  addressQuery?: string | undefined;
  /** The address in parts, sent as `address.*` query parameters. The parts are read as one address and do not filter. */
  address?: PostalAddress | undefined;
  /** A box to prefer results in. It is ignored when the address names a place outright. */
  locationBias?: GeocodeLocationBias | undefined;
  /** The language of the results. Default is the language of the place itself. */
  languageCode?: string | undefined;
  /** A two-letter region code. It sways the results and does not restrict them. */
  regionCode?: string | undefined;
  /** How much work the geocoder puts in. Google reads it on `/v4alpha` only. */
  effort?: Effort | undefined;
}

/** The response of `geocode.address`. */
export interface GeocodeAddressResponse {
  /** The results. Usually one, and several for an address that can be read more than one way. Left out when there are none. */
  results?: GeocodeResult[];
}

/**
 * The request of `geocode.location`.
 * Give the point as `locationQuery` or as `location`, not both.
 */
export interface GeocodeLocationParams {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Every field is returned without one. */
  fieldMask?: readonly GeocodeLocationField[] | undefined;
  /** The point as `"lat,lng"`. It is the last part of the request's path. */
  locationQuery?: string | undefined;
  /** The point in parts, sent as `location.latitude` and `location.longitude`. */
  location?: LatLng | undefined;
  /** The language of the results. Default is the language of the place itself. */
  languageCode?: string | undefined;
  /** A two-letter region code. It formats the addresses. */
  regionCode?: string | undefined;
  /** Keeps only results that have any of these types. Applied after the search. */
  types?: readonly string[] | undefined;
  /** Keeps only results of any of these granularities. Applied after the search. */
  granularity?: readonly Granularity[] | undefined;
}

/** The response of `geocode.location`. */
export interface GeocodeLocationResponse {
  /** The results, generally the most exact first. Left out when there are none. */
  results?: GeocodeResult[];
  /** The Plus Code of the point asked for. */
  plusCode?: PlusCode;
}

/** The request of `geocode.place`. */
export interface GeocodePlaceParams {
  /** The place's resource name, `places/{placeId}`. It is the path of the request. */
  place: string;
  /** The response fields wanted, as paths of the result itself, sent as `X-Goog-FieldMask`. Every field is returned without one. */
  fieldMask?: readonly GeocodePlaceField[] | undefined;
  /** The language of the result. Default is the language of the place itself. */
  languageCode?: string | undefined;
  /** A two-letter region code. It formats the address. */
  regionCode?: string | undefined;
}

// Place Photos.

/**
 * The request of `places.getPhotoMedia`.
 * Give `maxWidthPx`, `maxHeightPx` or both, each within [1, 4800]. A larger photo is scaled down to fit, keeping its shape.
 */
export type GetPhotoMediaParams = {
  /** The photo's media resource name, `places/{placeId}/photos/{photoReference}/media`. It is the path of the request. */
  name: string;
} & (
  | { maxWidthPx: number; maxHeightPx?: number | undefined }
  | { maxWidthPx?: number | undefined; maxHeightPx: number }
);

/** The response of `places.getPhotoMedia`. */
export interface PhotoMedia {
  /** The photo's media resource name. */
  name?: string;
  /** A short-lived URI of the image. */
  photoUri?: string;
}

// Search Destinations.

/** What kind of structure a place is. */
export type StructureType =
  | "STRUCTURE_TYPE_UNSPECIFIED"
  | "POINT"
  | "SECTION"
  | "BUILDING"
  | "GROUNDS";

/** How addressable a place found by a point must be. */
export type Addressability = "ADDRESSABILITY_UNSPECIFIED" | "ANY" | "PRIMARY" | "WEAK";

/** Which places a point may find. */
export interface PlaceFilter {
  /** The kind of structure to find. */
  structureType?: StructureType | undefined;
  /** How addressable the place must be. */
  addressability?: Addressability | undefined;
}

/** An address to find destinations at, as one text or in parts. */
export type DestinationAddressQuery =
  | { addressQuery: string; address?: never }
  | { address: PostalAddress; addressQuery?: never };

/** A point to find destinations at. */
export interface DestinationLocationQuery {
  /** The point. */
  location: LatLng;
  /** Which places the point may find. */
  placeFilter?: PlaceFilter | undefined;
}

/** What to find destinations at. Exactly one is given. */
export type DestinationQuery =
  | { place: string; addressQuery?: never; locationQuery?: never }
  | { addressQuery: DestinationAddressQuery; place?: never; locationQuery?: never }
  | { locationQuery: DestinationLocationQuery; place?: never; addressQuery?: never };

/** The request of `geocode.destinations`. */
export type SearchDestinationsParams = DestinationQuery & {
  /** The response fields wanted, sent as `X-Goog-FieldMask`. Every field is returned without one. */
  fieldMask?: readonly SearchDestinationsField[] | undefined;
  /** Keeps only navigation points reachable by these modes. All are kept without it. */
  travelModes?: readonly NavigationTravelMode[] | undefined;
  /** The language of the results. Default is the language of the place itself. */
  languageCode?: string | undefined;
  /** A two-letter region code. It formats the addresses. */
  regionCode?: string | undefined;
};

/** An outline, as a GeoJSON Polygon or MultiPolygon. */
export type DisplayPolygon =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

/** A place as a destination tells of it. */
export interface PlaceView {
  /** The resource name, `places/{placeId}`. */
  place?: string;
  /** The place ID. */
  placeId?: string;
  /** The place's name. */
  displayName?: LocalizedText;
  /** What the place is, as one type tag. */
  primaryType?: string;
  /** What the place is, as type tags. */
  types?: string[];
  /** The address on one line. */
  formattedAddress?: string;
  /** The address in postal form. */
  postalAddress?: PostalAddress;
  /** What kind of structure the place is. */
  structureType?: StructureType;
  /** Where the place is. */
  location?: ResponseLatLng;
  /** The place's outline. */
  displayPolygon?: DisplayPolygon;
  /** The parts of the address. */
  addressComponents?: AddressComponent[];
}

/** How a landmark helps find a destination. */
export type DestinationLandmarkTag = "TAG_UNSPECIFIED" | "ADDRESS" | "ARRIVAL";

/** A landmark near a destination. */
export interface DestinationLandmark {
  /** The landmark. */
  place?: PlaceView;
  /** How the destination lies to the landmark, in words. */
  relationalDescription?: LocalizedText;
  /** How the landmark helps. */
  tags?: DestinationLandmarkTag[];
  /** Meters between the two in a straight line. */
  straightLineDistanceMeters?: number;
  /** Meters between the two along the road or path network. */
  travelDistanceMeters?: number;
}

/** A way into a destination. */
export interface DestinationEntrance {
  /** The entrance's name. */
  displayName?: LocalizedText;
  /** Where the entrance is. */
  location?: ResponseLatLng;
  /** Marks on the entrance. Left out when there are none. */
  tags?: EntranceTag[];
  /** The resource name of the place the entrance leads into. */
  place?: string;
}

/** What a destination's navigation point is for. It has `UNKNOWN`, which a place's has not. */
export type DestinationNavigationUsage = NavigationUsage | "UNKNOWN";

/** A point on the road network from which a destination is reached. */
export interface DestinationNavigationPoint {
  /** A token that names the point to other Google services. */
  navigationPointToken?: string;
  /** The point's name. */
  displayName?: LocalizedText;
  /** Where the point is. */
  location?: ResponseLatLng;
  /** How the point can be reached. */
  travelModes?: NavigationTravelMode[];
  /** What the point is for. */
  usages?: DestinationNavigationUsage[];
}

/** A place one travels to, with what helps arrive at it. */
export interface Destination {
  /** The place the query names. */
  primary?: PlaceView;
  /** The places that hold it, such as its building or grounds. */
  containingPlaces?: PlaceView[];
  /** The places it holds, such as units or shops. */
  subDestinations?: PlaceView[];
  /** Landmarks near it. */
  landmarks?: DestinationLandmark[];
  /** Its entrances. */
  entrances?: DestinationEntrance[];
  /** Points on the road network to stop at. */
  navigationPoints?: DestinationNavigationPoint[];
}

/** The response of `geocode.destinations`. */
export interface SearchDestinationsResponse {
  /** The destinations. Usually one, and several for a query that can be read more than one way. Left out when there are none. */
  destinations?: Destination[];
}

/** A field path of a destination. */
export type DestinationField = Under<keyof Destination & string>;

/** A field mask path of `geocode.destinations`. */
export type SearchDestinationsField = "*" | "destinations" | `destinations.${DestinationField}`;

// Errors.

/** One detail of an error, such as a `google.rpc.ErrorInfo`. */
export interface ErrorDetail {
  /** The type of the detail, such as `type.googleapis.com/google.rpc.ErrorInfo`. */
  "@type"?: string;
  /** Why the request failed, on an `ErrorInfo`, such as `API_KEY_INVALID`. */
  reason?: string;
  /** The service that failed, on an `ErrorInfo`. */
  domain?: string;
  /** More about the failure, on an `ErrorInfo`. */
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

/** The names of `google.rpc.Code`. */
export type ErrorStatus =
  | "INVALID_ARGUMENT"
  | "FAILED_PRECONDITION"
  | "OUT_OF_RANGE"
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "RESOURCE_EXHAUSTED"
  | "UNIMPLEMENTED"
  | "INTERNAL"
  | "UNKNOWN"
  | "DATA_LOSS"
  | "UNAVAILABLE"
  | "DEADLINE_EXCEEDED"
  | "CANCELLED"
  | "ALREADY_EXISTS"
  | "ABORTED";

/** The body of an error answer. It is the `body` of the error a failed call throws. */
export interface ErrorResponse {
  error?: {
    /** The HTTP status. */
    code?: number;
    /** What went wrong, written for a developer. */
    message?: string;
    /** The name of the error. */
    status?: ErrorStatus;
    /** More about the error. Present only when the server attaches details. */
    details?: ErrorDetail[];
  };
}
