/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { google } from "../src/google.ts";
import {
  distance,
  emptyAddress,
  Geocoder,
  type GeocoderError,
  PermissionDeniedError,
} from "../src/index.ts";
import autocompleteOrigin from "./fixtures/google/autocomplete-origin.json" with { type: "json" };
import invalidArgument from "./fixtures/google/error-invalid-argument.json" with { type: "json" };
import permissionDenied from "./fixtures/google/error-permission-denied.json" with { type: "json" };
import geocodeAddress from "./fixtures/google/geocode-address.json" with { type: "json" };
import placeDetailsMoved from "./fixtures/google/place-details-moved.json" with { type: "json" };
import placeDetails from "./fixtures/google/place-details.json" with { type: "json" };
import { type Fetch, fakeFetch, urlOf } from "./helpers.ts";

/**
 * A documented example that Google's docs shorten with `...` or `/.../`.
 * The file is the example as printed, and only the elision marks are taken out on load.
 */
function elided<T>(name: string): T {
  const printed = readFileSync(new URL(`./fixtures/google/${name}`, import.meta.url), "utf8");
  return JSON.parse(
    printed.replace(/^\s*(\.\.\.|\/\.\.\.\/)\s*$/gm, "").replace(/,(\s*[\]}])/g, "$1"),
  ) as T;
}

interface WirePoint {
  latitude: number;
  longitude: number;
}
interface WireResults {
  results: { location: WirePoint; viewport: { low: WirePoint; high: WirePoint } }[];
}

const reverseLocation = elided<WireResults>("reverse-location.txt");
const autocompleteArt = elided<{ suggestions: unknown[] }>("autocomplete.txt");
const textSearch = elided<{ places: unknown[] }>("text-search.txt");
const nearbySearch = elided<{ places: unknown[] }>("nearby-search.txt");

/** Built by hand from the Place reference, since no documented example carries these fields together. */
const googleplex = {
  id: "ChIJj61dQgK6j4AR4GeTYWZsKWw",
  displayName: { text: "Googleplex", languageCode: "en" },
  types: ["corporate_office", "point_of_interest", "establishment"],
  primaryType: "corporate_office",
  primaryTypeDisplayName: { text: "Corporate office", languageCode: "en" },
  formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
  location: { latitude: 37.4220541, longitude: -122.08532419999999 },
  viewport: {
    low: { latitude: 37.4209489697085, longitude: -122.08846930000001 },
    high: { latitude: 37.4236469302915, longitude: -122.0829156 },
  },
  addressComponents: [
    { longText: "Suite 200", shortText: "Suite 200", types: ["subpremise"] },
    { longText: "1600", shortText: "1600", types: ["street_number"] },
    { longText: "Amphitheatre Parkway", shortText: "Amphitheatre Pkwy", types: ["route"] },
    { longText: "Mountain View", shortText: "Mountain View", types: ["locality", "political"] },
    {
      longText: "California",
      shortText: "CA",
      types: ["administrative_area_level_1", "political"],
    },
    { longText: "United States", shortText: "us", types: ["country", "political"] },
    { longText: "94043", shortText: "94043", types: ["postal_code"] },
  ],
  postalAddress: { regionCode: "US", addressLines: ["1600 Amphitheatre Pkwy", "Suite 200"] },
  plusCode: { globalCode: "849VCWC7+RW", compoundCode: "CWC7+RW Mountain View, CA, USA" },
  internationalPhoneNumber: "+1 650-253-0000",
  websiteUri: "https://about.google/",
  regularOpeningHours: {
    openNow: true,
    weekdayDescriptions: ["Monday: Open 24 hours", "Tuesday: Closed"],
  },
  currentOpeningHours: { openNow: false },
  rating: 4.2,
  userRatingCount: 2594,
  businessStatus: "OPERATIONAL",
  timeZone: { id: "America/Los_Angeles" },
  utcOffsetMinutes: -420,
  entrances: [{ location: { latitude: 37.422189, longitude: -122.084215 }, tags: ["PREFERRED"] }],
};

const KEY = "test-key";
const PLACE_MASK =
  "places.id,places.attributions,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents";

// Google requires the text `Google Maps`, unchanged and untranslated, wherever its content is shown off a Google map.
// Source: https://developers.google.com/maps/documentation/geocoding/policies, under attribution requirements.
const GOOGLE_MAPS = [{ text: "Google Maps", url: null, licence: null }];
const GEOCODE_MASK =
  "results.placeId,results.location,results.granularity,results.formattedAddress,results.addressComponents,results.types";
const SUGGESTION_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.types";

const geocoder = (fetch: typeof globalThis.fetch) =>
  new Geocoder({ adapter: google({ apiKey: KEY, fetch, logLevel: "off", maxRetries: 0 }) });

const init = (fetch: Fetch, call = 0) => fetch.mock.calls[call]![1]!;
const headers = (fetch: Fetch, call = 0) => init(fetch, call).headers as Record<string, string>;
const body = (fetch: Fetch, call = 0) => JSON.parse(init(fetch, call).body as string) as unknown;

const mountainView = {
  houseNumber: "1600",
  street: "Amphitheatre Parkway",
  unit: null,
  neighbourhood: null,
  locality: "Mountain View",
  district: "Santa Clara County",
  region: "California",
  regionCode: "CA",
  postcode: "94043",
  country: "United States",
  countryCode: "US",
};

describe("the google adapter", () => {
  it("says what it supports", () => {
    const { capabilities } = geocoder(fakeFetch());
    expect(capabilities.autocomplete?.coordinates).toBe(false);
    expect(capabilities.geocode?.options).toEqual(["limit", "language", "types", "structured"]);
    expect(capabilities.places?.options).toEqual(["limit", "language", "focus", "bounds", "types"]);
    expect(capabilities.lookup?.options).toEqual(["language", "session"]);
    expect(capabilities.batch).toEqual({ geocode: "emulated", reverse: "emulated" });
  });

  describe("geocode", () => {
    it("sends free text in the path and maps the result", async () => {
      const fetch = fakeFetch({ body: geocodeAddress });
      const answer = await geocoder(fetch).geocode("1600 Amphitheatre Parkway, Mountain View, CA", {
        language: ["en", "fr"],
        countries: ["us"],
        focus: { lat: 37.4, lon: -122.1 },
        include: ["bbox", "addressDetails", "addressLines", "plusCode"],
      });
      expect(init(fetch).method).toBe("GET");
      expect(urlOf(fetch).href).toBe(
        "https://geocode.googleapis.com/v4/geocode/address/1600%20Amphitheatre%20Parkway%2C%20Mountain%20View%2C%20CA?languageCode=en",
      );
      expect(headers(fetch)).toMatchObject({
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": `${GEOCODE_MASK},results.viewport,results.bounds,results.postalAddress,results.plusCode`,
      });
      expect(answer).toEqual({
        provider: "google",
        operation: "geocode",
        results: [
          {
            id: "ChIJxQvW8wK6j4AR3ukttGy3w2s",
            type: "address",
            name: "1600 Amphitheatre Pkwy",
            label: "Google Building 41, 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
            location: { lat: 37.4224119, lon: -122.08550779999999 },
            accuracy: "rooftop",
            confidence: null,
            distance: 2801.58,
            address: mountainView,
            bbox: [-122.08713963029149, 37.420886519708496, -122.0844416697085, 37.423584480291495],
            addressDetails: {
              unitType: null,
              building: "Google Building 41",
              floor: null,
              sublocality: null,
              postcodeSuffix: "1351",
            },
            addressLines: ["1600 Amphitheatre Pkwy"],
            plusCode: null,
          },
        ],
        attribution: GOOGLE_MAPS,
        unavailable: ["confidence"],
        ignored: ["countries", "focus"],
      });
    });

    it("sends a structured address as address.* parameters", async () => {
      const fetch = fakeFetch({ body: geocodeAddress });
      const answer = await geocoder(fetch).geocode({
        houseNumber: "1600",
        street: "Amphitheatre Pkwy",
        locality: "Mountain View",
        region: "CA",
        postcode: "94043",
        country: "us",
      });
      expect(urlOf(fetch).href).toBe(
        "https://geocode.googleapis.com/v4/geocode/address?address.addressLines=1600+Amphitheatre+Pkwy&address.locality=Mountain+View&address.administrativeArea=CA&address.postalCode=94043&address.regionCode=US",
      );
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe(GEOCODE_MASK);
      expect(answer.ignored).toEqual([]);
      expect(answer.results).toHaveLength(1);
    });

    it("sends a country name as the last address line", async () => {
      const fetch = fakeFetch({ body: geocodeAddress });
      await geocoder(fetch).geocode({ address: "10 Downing St", country: "United Kingdom" });
      expect(urlOf(fetch).search).toBe(
        "?address.addressLines=10+Downing+St&address.addressLines=United+Kingdom",
      );
    });

    it("keeps only the types asked for", async () => {
      const geo = geocoder(fakeFetch({ body: geocodeAddress }));
      expect((await geo.geocode("x", { types: ["locality"] })).results).toEqual([]);
      expect((await geo.geocode("x", { types: ["address", "poi"] })).results).toHaveLength(1);
    });

    it("asks for every field and returns the records untouched with raw", async () => {
      const fetch = fakeFetch({ body: geocodeAddress });
      const answer = await geocoder(fetch).geocode("x", { include: ["raw"] });
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe("*");
      expect(answer.raw).toEqual(geocodeAddress);
      expect(answer.results[0]!.raw).toEqual(geocodeAddress.results[0]);
    });

    it("answers nothing for an empty body", async () => {
      const answer = await geocoder(fakeFetch({ body: {} })).geocode("nowhere at all");
      expect(answer.results).toEqual([]);
    });
  });

  describe("reverse", () => {
    it("sends the point in the path and measures the distance to each result", async () => {
      const fetch = fakeFetch({ body: reverseLocation });
      const at = { lat: 37.4225508, lon: -122.0846338 };
      const answer = await geocoder(fetch).reverse(at, {
        types: ["address"],
        include: ["bbox", "plusCode", "rating"],
      });
      const wire = reverseLocation.results[0]!;
      const location = { lat: wire.location.latitude, lon: wire.location.longitude };
      expect(init(fetch).method).toBe("GET");
      expect(urlOf(fetch).href).toBe(
        "https://geocode.googleapis.com/v4/geocode/location/37.4225508,-122.0846338",
      );
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe(
        `${GEOCODE_MASK},results.viewport,results.bounds,results.plusCode`,
      );
      expect(answer.results).toEqual([
        {
          id: "ChIJV-FZF7i7j4ARo4ZOUoecZFU",
          type: "address",
          name: "1600 Amphitheatre Pkwy",
          label: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
          location,
          accuracy: "rooftop",
          confidence: null,
          distance: Math.round(distance(at, location) * 100) / 100,
          address: mountainView,
          bbox: [
            wire.viewport.low.longitude,
            wire.viewport.low.latitude,
            wire.viewport.high.longitude,
            wire.viewport.high.latitude,
          ],
          plusCode: { global: "849VCW83+PM", compound: "CW83+PM Mountain View, CA, USA" },
          rating: null,
        },
      ]);
      expect(answer.results[0]!.distance).toBeGreaterThan(4);
      expect(answer.results[0]!.distance).toBeLessThan(5);
      expect(answer.unavailable).toEqual(["confidence", "rating"]);
      expect(answer.ignored).toEqual([]);
    });
  });

  describe("autocomplete", () => {
    it("posts the search and maps place predictions", async () => {
      const fetch = fakeFetch({ body: autocompleteArt });
      const answer = await geocoder(fetch).autocomplete("Art museum", {
        limit: 5,
        language: "en",
        countries: ["US", "CA"],
        bounds: [-122.52, 37.7, -122.35, 37.83],
        session: "3519edfe-0f75-4a30-bfe4-7cbd89340b2c",
        include: ["highlights"],
      });
      expect(init(fetch).method).toBe("POST");
      expect(urlOf(fetch).href).toBe("https://places.googleapis.com/v1/places:autocomplete");
      expect(headers(fetch)).toMatchObject({
        "content-type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": `${SUGGESTION_MASK},suggestions.placePrediction.text.matches`,
      });
      expect(body(fetch)).toEqual({
        input: "Art museum",
        languageCode: "en",
        includedRegionCodes: ["us", "ca"],
        locationRestriction: {
          rectangle: {
            low: { latitude: 37.7, longitude: -122.52 },
            high: { latitude: 37.83, longitude: -122.35 },
          },
        },
        sessionToken: "3519edfe-0f75-4a30-bfe4-7cbd89340b2c",
      });
      expect(answer).toEqual({
        provider: "google",
        operation: "autocomplete",
        results: [
          {
            id: "ChIJkQQVTZqAhYARHxPt2iJkm1Q",
            type: "poi",
            name: "Asian Art Museum",
            label: "Asian Art Museum, Larkin Street, San Francisco, CA, USA",
            location: null,
            accuracy: null,
            confidence: null,
            distance: null,
            address: emptyAddress(),
            highlights: [{ start: 6, end: 16 }],
          },
          {
            id: "ChIJI7NivpmAhYARSuRPlbbn_2w",
            type: "poi",
            name: "de Young Museum",
            label: "de Young Museum, Hagiwara Tea Garden Drive, San Francisco, CA, USA",
            location: null,
            accuracy: null,
            confidence: null,
            distance: null,
            address: emptyAddress(),
            highlights: [{ start: 0, end: 15 }],
          },
        ],
        attribution: GOOGLE_MAPS,
        unavailable: ["location", "accuracy", "confidence", "address"],
        ignored: [],
      });
    });

    it("sends focus as origin and bias, and reads the distance", async () => {
      const fetch = fakeFetch({ body: autocompleteOrigin });
      const answer = await geocoder(fetch).autocomplete("Amoeba", {
        focus: { lat: 37.76999, lon: -122.44696 },
        types: ["poi"],
        include: ["raw"],
      });
      const origin = { latitude: 37.76999, longitude: -122.44696 };
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe("*");
      expect(body(fetch)).toEqual({
        input: "Amoeba",
        origin,
        locationBias: { circle: { center: origin, radius: 50000 } },
      });
      expect(answer.results).toHaveLength(1);
      expect(answer.results[0]).toMatchObject({
        id: "ChIJ5YQQf1GHhYARPKG7WLIaOko",
        name: "Amoeba Music",
        distance: 3012,
        raw: autocompleteOrigin.suggestions[0]!.placePrediction,
      });
      expect(answer.raw).toEqual(autocompleteOrigin);
    });

    it("asks for the distance only with a focus", async () => {
      const fetch = fakeFetch({ body: autocompleteOrigin });
      await geocoder(fetch).autocomplete("Amoeba", { focus: { lat: 37.7, lon: -122.4 } });
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe(
        `${SUGGESTION_MASK},suggestions.placePrediction.distanceMeters`,
      );
    });

    it("sends primary types where they read exactly as the unified ones, and filters the answer", async () => {
      const fetch = fakeFetch({ body: autocompleteOrigin });
      const geo = geocoder(fetch);
      const streets = await geo.autocomplete("Haight", { types: ["address", "street"] });
      expect(body(fetch)).toEqual({
        input: "Haight",
        includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
      });
      expect(streets.results).toEqual([]);
      expect(streets.ignored).toEqual([]);
      // Six Google types are one more than the API takes, so only the adapter's own filter applies.
      await geo.autocomplete("Haight", { types: ["address", "street", "locality"] });
      expect(body(fetch, 1)).toEqual({ input: "Haight" });
    });

    it("leaves out suggestions that are not places", async () => {
      const fetch = fakeFetch({
        body: { suggestions: [{ queryPrediction: { text: { text: "Amoeba Music" } } }] },
      });
      expect((await geocoder(fetch).autocomplete("Amoeba")).results).toEqual([]);
    });
  });

  describe("places", () => {
    it("posts a text search with a lean field mask", async () => {
      const fetch = fakeFetch({ body: textSearch });
      const answer = await geocoder(fetch).places("Spicy Vegetarian Food in Sydney, Australia", {
        limit: 1,
        language: "en",
        countries: ["AU"],
        focus: { lat: -33.87, lon: 151.21 },
      });
      expect(init(fetch).method).toBe("POST");
      expect(urlOf(fetch).href).toBe("https://places.googleapis.com/v1/places:searchText");
      expect(headers(fetch)).toMatchObject({
        "content-type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": PLACE_MASK,
      });
      expect(body(fetch)).toEqual({
        textQuery: "Spicy Vegetarian Food in Sydney, Australia",
        languageCode: "en",
        pageSize: 1,
        locationBias: {
          circle: { center: { latitude: -33.87, longitude: 151.21 }, radius: 50000 },
        },
      });
      expect(answer).toEqual({
        provider: "google",
        operation: "places",
        results: [
          {
            id: null,
            type: "unknown",
            name: "Mother Chu's Vegetarian Kitchen",
            label: "367 Pitt St, Sydney NSW 2000, Australia",
            location: null,
            accuracy: null,
            confidence: null,
            distance: null,
            address: emptyAddress(),
          },
        ],
        attribution: GOOGLE_MAPS,
        unavailable: ["accuracy", "confidence"],
        ignored: ["countries"],
      });
    });

    it("sends bounds as a restriction and maps entrances and navigation points", async () => {
      const fetch = fakeFetch({ body: nearbySearch });
      const answer = await geocoder(fetch).places("SFO", {
        limit: 50,
        bounds: [-122.5, 37.5, -122.3, 37.7],
        focus: { lat: 37.6, lon: -122.4 },
        include: ["accessPoints"],
      });
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe(
        `${PLACE_MASK},places.entrances,places.navigationPoints`,
      );
      expect(body(fetch)).toEqual({
        textQuery: "SFO",
        pageSize: 20,
        locationRestriction: {
          rectangle: {
            low: { latitude: 37.5, longitude: -122.5 },
            high: { latitude: 37.7, longitude: -122.3 },
          },
        },
      });
      expect(answer.results).toEqual([
        {
          id: "ChIJVVVVVYx3j4ARP-3NGldc8qQ",
          type: "unknown",
          name: "San Francisco International Airport",
          label: "San Francisco International Airport",
          location: null,
          accuracy: null,
          confidence: null,
          distance: null,
          address: emptyAddress(),
          accessPoints: [
            { lat: 37.6172154, lon: -122.3839724, kind: null },
            { lat: 37.6174073, lon: -122.384196, kind: null },
            { lat: 37.6153121, lon: -122.3900833, kind: null },
            { lat: 37.6157153, lon: -122.3885012, kind: "PARKING" },
          ],
        },
      ]);
    });

    it("takes the whole page when it filters by type, and measures from the focus", async () => {
      const fetch = fakeFetch({ body: { places: [googleplex] } });
      const focus = { lat: 37.42, lon: -122.08 };
      const geo = geocoder(fetch);
      const answer = await geo.places("Googleplex", { limit: 1, types: ["poi"], focus });
      expect(body(fetch)).not.toHaveProperty("pageSize");
      expect(answer.results[0]!.distance).toBe(522.72);
      expect((await geo.places("Googleplex", { types: ["locality"] })).results).toEqual([]);
    });
  });

  describe("lookup", () => {
    it("gets one place per id and fills every field asked for", async () => {
      const fetch = fakeFetch({ body: googleplex });
      const answer = await geocoder(fetch).lookup(googleplex.id, {
        language: "en",
        session: "3519edfe-0f75-4a30-bfe4-7cbd89340b2c",
        include: [
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
          "brand",
        ],
      });
      expect(init(fetch).method).toBe("GET");
      expect(urlOf(fetch).href).toBe(
        "https://places.googleapis.com/v1/places/ChIJj61dQgK6j4AR4GeTYWZsKWw?languageCode=en&sessionToken=3519edfe-0f75-4a30-bfe4-7cbd89340b2c",
      );
      expect(headers(fetch)).toMatchObject({
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask":
          "id,attributions,displayName,formattedAddress,location,types,addressComponents,viewport,postalAddress,primaryType,primaryTypeDisplayName,internationalPhoneNumber,websiteUri,regularOpeningHours.weekdayDescriptions,regularOpeningHours.openNow,currentOpeningHours.openNow,rating,userRatingCount,businessStatus,timeZone,utcOffsetMinutes,entrances,navigationPoints,plusCode",
      });
      expect(answer).toEqual({
        provider: "google",
        operation: "lookup",
        results: [
          {
            id: "ChIJj61dQgK6j4AR4GeTYWZsKWw",
            type: "poi",
            name: "Googleplex",
            label: "Googleplex, 1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
            location: { lat: 37.4220541, lon: -122.08532419999999 },
            accuracy: null,
            confidence: null,
            distance: null,
            address: { ...mountainView, unit: "Suite 200", district: null },
            bbox: [-122.08846930000001, 37.4209489697085, -122.0829156, 37.4236469302915],
            addressDetails: {
              unitType: null,
              building: null,
              floor: null,
              sublocality: null,
              postcodeSuffix: null,
            },
            addressLines: ["1600 Amphitheatre Pkwy", "Suite 200"],
            categories: [
              { id: "corporate_office", name: "Corporate office", primary: true },
              { id: "point_of_interest", name: null, primary: false },
              { id: "establishment", name: null, primary: false },
            ],
            contact: { phone: "+1 650-253-0000", website: "https://about.google/", email: null },
            openingHours: {
              text: ["Monday: Open 24 hours", "Tuesday: Closed"],
              openNow: false,
            },
            rating: { value: 4.2, count: 2594 },
            businessStatus: "operational",
            timezone: { name: "America/Los_Angeles", utcOffsetMinutes: -420 },
            accessPoints: [{ lat: 37.422189, lon: -122.084215, kind: "PREFERRED" }],
            plusCode: { global: "849VCWC7+RW", compound: "CWC7+RW Mountain View, CA, USA" },
            brand: null,
          },
        ],
        attribution: GOOGLE_MAPS,
        unavailable: ["accuracy", "confidence", "distance", "brand"],
        ignored: [],
      });
    });

    it("maps the documented details example", async () => {
      const fetch = fakeFetch({ body: placeDetails });
      const answer = await geocoder(fetch).lookup(placeDetails.id, {
        include: ["plusCode", "raw"],
      });
      expect(urlOf(fetch).href).toBe(
        "https://places.googleapis.com/v1/places/ChIJj61dQgK6j4AR4GeTYWZsKWw",
      );
      expect(headers(fetch)["X-Goog-FieldMask"]).toBe("*");
      expect(answer.results).toEqual([
        {
          id: "ChIJj61dQgK6j4AR4GeTYWZsKWw",
          type: "unknown",
          name: "Googleplex",
          label: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
          location: null,
          accuracy: null,
          confidence: null,
          distance: null,
          address: emptyAddress(),
          plusCode: { global: "849VCWC7+RW", compound: "CWC7+RW Mountain View, CA, USA" },
          raw: placeDetails,
        },
      ]);
      expect(answer.raw).toEqual([placeDetails]);
    });

    it("reads the business status of a place that moved", async () => {
      const fetch = fakeFetch({ body: placeDetailsMoved });
      const answer = await geocoder(fetch).lookup(placeDetailsMoved.id, {
        include: ["businessStatus"],
      });
      expect(answer.results[0]).toMatchObject({
        name: "Marche IGA St-Canut",
        businessStatus: "closed_permanently",
      });
    });

    it("answers nothing for an id Google does not know", async () => {
      const gone = {
        status: 404,
        body: { error: { code: 404, message: "Place not found.", status: "NOT_FOUND" } },
      };
      expect((await geocoder(fakeFetch(gone)).lookup("gone")).results).toEqual([]);
      const fetch = fakeFetch(gone, { body: placeDetails });
      const answer = await geocoder(fetch).lookup(["gone", placeDetails.id]);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(answer.results.map((place) => place.id)).toEqual([placeDetails.id]);
    });

    it("fails when a request fails for any other reason", async () => {
      const fetch = fakeFetch({ body: placeDetails }, { status: 400, body: invalidArgument });
      const error = await geocoder(fetch)
        .lookup([placeDetails.id, "bad"])
        .catch((thrown: unknown) => thrown as GeocoderError);
      expect(error).toMatchObject({ code: "invalid_request", operation: "lookup" });
    });
  });

  describe("errors", () => {
    it("reads the message and the code from Google's error body", async () => {
      const fetch = fakeFetch({ status: 403, body: permissionDenied });
      const error = (await geocoder(fetch)
        .geocode("x")
        .catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error).toMatchObject({
        name: "GeocoderError",
        code: "permission_denied",
        message: "The request is missing a valid API key.",
        provider: "google",
        operation: "geocode",
        status: 403,
        body: permissionDenied,
      });
      expect(error.cause).toBeInstanceOf(PermissionDeniedError);
      expect((error.cause as PermissionDeniedError).body).toEqual(permissionDenied);
    });

    it("maps the documented invalid argument body", async () => {
      const fetch = fakeFetch({ status: 400, body: invalidArgument });
      const error = (await geocoder(fetch)
        .places("x")
        .catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error).toMatchObject({
        code: "invalid_request",
        message: "Origin and destination must be set.",
      });
    });

    it.each([
      [429, "RESOURCE_EXHAUSTED", "rate_limited"],
      // The cases below are the ones the HTTP status alone would misread.
      [403, "RESOURCE_EXHAUSTED", "rate_limited"],
      [500, "UNIMPLEMENTED", "unsupported"],
      [504, "DEADLINE_EXCEEDED", "timeout"],
      [500, "UNAVAILABLE", "unavailable"],
      [400, "UNAUTHENTICATED", "unauthenticated"],
    ])("reads HTTP %i with status %s as %s", async (status, name, code) => {
      const fetch = fakeFetch({
        status,
        body: { error: { code: status, message: "No.", status: name } },
      });
      const error = (await geocoder(fetch)
        .reverse({ lat: 1, lon: 2 })
        .catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error.code).toBe(code);
      expect(error.message).toBe("No.");
    });

    it("reads a rejected key as unauthenticated", async () => {
      const fetch = fakeFetch({
        status: 400,
        body: {
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
            details: [
              { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" },
            ],
          },
        },
      });
      const error = (await geocoder(fetch)
        .geocode("x")
        .catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error.code).toBe("unauthenticated");
    });

    it("falls back to the HTTP status when the body is not Google's", async () => {
      const fetch = fakeFetch({ status: 502, body: "<html>Bad Gateway</html>" });
      const error = (await geocoder(fetch)
        .geocode("x")
        .catch((thrown: unknown) => thrown)) as GeocoderError;
      expect(error.code).toBe("unavailable");
    });
  });

  describe("batch", () => {
    it("emulates a geocode batch with single calls", async () => {
      const fetch = fakeFetch({ body: geocodeAddress });
      const answer = await geocoder(fetch).batch.geocode([
        "1600 Amphitheatre Parkway",
        { id: "b", address: { address: "1600 Amphitheatre Pkwy", locality: "Mountain View" } },
      ]);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(answer.mode).toBe("emulated");
      expect(answer.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
      expect(answer.items.map((item) => [item.id, item.results[0]!.id])).toEqual([
        [null, "ChIJxQvW8wK6j4AR3ukttGy3w2s"],
        ["b", "ChIJxQvW8wK6j4AR3ukttGy3w2s"],
      ]);
      expect(answer.unavailable).toEqual(["confidence", "distance"]);
    });

    it("emulates a reverse batch and keeps a failed item apart", async () => {
      const fetch = fakeFetch({ body: reverseLocation }, { status: 400, body: invalidArgument });
      const answer = await geocoder(fetch).batch.reverse(
        [
          { lat: 37.4225508, lon: -122.0846338 },
          { lat: 91, lon: 0 },
        ],
        { concurrency: 1 },
      );
      expect(answer.mode).toBe("emulated");
      expect(answer.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
      expect(answer.items[1]!.error).toMatchObject({ code: "invalid_request" });
    });
  });

  describe("native", () => {
    it("reaches Places with the key applied", async () => {
      const fetch = fakeFetch({ body: nearbySearch });
      const search = {
        locationRestriction: {
          circle: { center: { latitude: 37.6, longitude: -122.4 }, radius: 500 },
        },
      };
      const answer = await geocoder(fetch).native.places<{ places: unknown[] }>({
        path: "/v1/places:searchNearby",
        body: search,
        headers: { "X-Goog-FieldMask": "places.id" },
      });
      expect(init(fetch).method).toBe("POST");
      expect(urlOf(fetch).href).toBe("https://places.googleapis.com/v1/places:searchNearby");
      expect(headers(fetch)).toMatchObject({
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "places.id",
      });
      expect(body(fetch)).toEqual(search);
      expect(answer.places).toHaveLength(1);
    });

    it("reaches Geocoding with the key applied", async () => {
      const fetch = fakeFetch({ body: geocodeAddress.results[0] });
      const answer = await geocoder(fetch).native.geocoding<{ placeId: string }>({
        path: "/v4/geocode/places/ChIJxQvW8wK6j4AR3ukttGy3w2s",
        query: { languageCode: "en" },
      });
      expect(init(fetch).method).toBe("GET");
      expect(urlOf(fetch).href).toBe(
        "https://geocode.googleapis.com/v4/geocode/places/ChIJxQvW8wK6j4AR3ukttGy3w2s?languageCode=en",
      );
      expect(headers(fetch)["X-Goog-Api-Key"]).toBe(KEY);
      expect(answer.placeId).toBe("ChIJxQvW8wK6j4AR3ukttGy3w2s");
    });

    it("sends each API to the base URL it was given", async () => {
      const fetch = fakeFetch({ body: {} });
      const geo = new Geocoder({
        adapter: google({
          apiKey: KEY,
          fetch,
          logLevel: "off",
          placesBaseUrl: "http://proxy.test/places/",
          geocodingBaseUrl: "http://proxy.test/geocode/",
          headers: { "x-gateway": "yes" },
        }),
      });
      await geo.places("x");
      await geo.geocode("x");
      expect(urlOf(fetch, 0).href).toBe("http://proxy.test/places/v1/places:searchText");
      expect(urlOf(fetch, 1).href).toBe("http://proxy.test/geocode/v4/geocode/address/x");
      expect(headers(fetch, 1)).toMatchObject({ "x-gateway": "yes", "X-Goog-Api-Key": KEY });
    });
  });
});

const live = () =>
  new Geocoder({ adapter: google({ apiKey: process.env.GOOGLE_MAPS_API_KEY ?? "" }) });

describe("the google adapter, inside Google's terms", () => {
  it("credits each data provider Google names for a place, after Google itself", async () => {
    // Google's `attributions` on a place lists the data providers to credit with it.
    // The two below are made up, in the documented shape `{ provider, providerUri }`.
    const credited = [
      {
        ...googleplex,
        attributions: [{ provider: "Harrowmere Transit", providerUri: "https://transit.example/" }],
      },
      {
        ...googleplex,
        id: "second",
        attributions: [{ provider: "Harrowmere Transit" }, { provider: "Quillfield Survey" }],
      },
    ];
    const answer = await geocoder(fakeFetch({ body: { places: credited } })).places("Googleplex");
    expect(answer.attribution).toEqual([
      ...GOOGLE_MAPS,
      { text: "Harrowmere Transit", url: null, licence: null },
      { text: "Quillfield Survey", url: null, licence: null },
    ]);
  });

  it("lets a cache keep an answer for 30 days and no longer", () => {
    // Google lets latitude and longitude be kept for up to 30 consecutive calendar days.
    // Source: https://developers.google.com/maps/documentation/geocoding/policies, under caching.
    const { capabilities } = geocoder(fakeFetch({ body: {} }));
    expect(capabilities.cache).toEqual({ maxTtl: 30 * 24 * 60 * 60 * 1000 });
    for (const operation of ["geocode", "reverse", "autocomplete", "places", "lookup"] as const)
      expect(capabilities[operation]?.cache).toBeUndefined();
  });
});

describe.skipIf(!process.env.GOOGLE_MAPS_API_KEY)("the google adapter, live", () => {
  it("geocodes an address", async () => {
    const answer = await live().geocode("1600 Amphitheatre Parkway, Mountain View, CA", {
      include: ["bbox", "addressLines"],
    });
    const place = answer.results[0]!;
    expect(place.id).toEqual(expect.any(String));
    expect(place.location).toEqual({ lat: expect.any(Number), lon: expect.any(Number) });
    expect(place.address.countryCode).toBe("US");
    expect(place.bbox).toHaveLength(4);
  });

  it("reverse geocodes a point", async () => {
    const answer = await live().reverse({ lat: 37.4225508, lon: -122.0846338 });
    expect(answer.results.length).toBeGreaterThan(0);
    expect(answer.results[0]!.distance).toEqual(expect.any(Number));
  });

  it("resolves a suggestion with lookup in one session", async () => {
    const geo = live();
    const session = crypto.randomUUID();
    const suggestions = await geo.autocomplete("Googleplex", { session, include: ["highlights"] });
    const first = suggestions.results[0]!;
    expect(first.location).toBeNull();
    expect(first.id).toEqual(expect.any(String));
    const resolved = await geo.lookup(first.id!, { session, include: ["timezone"] });
    expect(resolved.results[0]!.location).toEqual({
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
  });

  it("searches places by name", async () => {
    const geo = live();
    const found = await geo.places("coffee in Mountain View", { limit: 3, include: ["rating"] });
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results.length).toBeLessThanOrEqual(3);
    expect(found.results[0]!.type).toEqual(expect.any(String));
  });
});
