/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import {
  BadRequestError,
  GeocoderError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "../src/errors.ts";
import { google, type GoogleClient, type GoogleOptions } from "../src/google.ts";
import autocompleteOrigin from "./fixtures/google/autocomplete-origin.json" with { type: "json" };
import invalidArgument from "./fixtures/google/error-invalid-argument.json" with { type: "json" };
import permissionDenied from "./fixtures/google/error-permission-denied.json" with { type: "json" };
import geocodeAddress from "./fixtures/google/geocode-address.json" with { type: "json" };
import placeDetailsMoved from "./fixtures/google/place-details-moved.json" with { type: "json" };
import placeDetails from "./fixtures/google/place-details.json" with { type: "json" };
import { bodyOf, type Fetch, fakeFetch, headersOf, type Reply, urlOf } from "./helpers.ts";

/**
 * A documented example that Google's docs shorten with `...` or `/.../`.
 * The file is the example as printed, and only the elision marks are taken out on load.
 */
function elided(name: string): Record<string, unknown> {
  const printed = readFileSync(new URL(`./fixtures/google/${name}`, import.meta.url), "utf8");
  return JSON.parse(
    printed.replace(/^\s*(\.\.\.|\/\.\.\.\/)\s*$/gm, "").replace(/,(\s*[\]}])/g, "$1"),
  ) as Record<string, unknown>;
}

const reverseLocation = elided("reverse-location.txt");
const autocompleteArt = elided("autocomplete.txt");
const textSearch = elided("text-search.txt");
const nearbySearch = elided("nearby-search.txt");

const DAY = 24 * 60 * 60 * 1000;
const KEY = "test-key";
const PLACE_ID = "ChIJj61dQgK6j4AR4GeTYWZsKWw";

interface Target {
  /** The server that answers. */
  server: "google" | "og";
  options: GoogleOptions;
  /** Where Places requests go. */
  places: string;
  /** Where Geocoding requests go. */
  geocode: string;
}

const TARGETS: Target[] = [
  {
    server: "google",
    options: { apiKey: KEY },
    places: "https://places.googleapis.com",
    geocode: "https://geocode.googleapis.com",
  },
  {
    server: "og",
    // The key is given too, to show that og is never sent it.
    options: { baseUrl: "http://og.test/", apiKey: KEY },
    places: "http://og.test/compat/google",
    geocode: "http://og.test/compat/google",
  },
];

function build(
  target: Target,
  replies: Reply[],
  extra: GoogleOptions = {},
): { client: GoogleClient; fetch: Fetch } {
  const fetch = fakeFetch(...replies);
  return {
    client: google({ ...target.options, fetch, logLevel: "off", ...extra }),
    fetch,
  };
}

function methodOf(fetch: Fetch, call = 0): string | undefined {
  return fetch.mock.calls[call]![1]?.method;
}

function hasBody(fetch: Fetch, call = 0): boolean {
  return fetch.mock.calls[call]![1]?.body !== undefined;
}

/** The key is in a header for Google, and nowhere for og. */
function expectCredential(target: Target, fetch: Fetch): void {
  const url = String(fetch.mock.calls[0]![0]);
  const headers = headersOf(fetch);
  expect(url).not.toContain(KEY);
  expect(urlOf(fetch).searchParams.has("key")).toBe(false);
  if (target.server === "google") expect(headers["x-goog-api-key"]).toBe(KEY);
  else {
    expect(headers).not.toHaveProperty("x-goog-api-key");
    expect(JSON.stringify(headers)).not.toContain(KEY);
  }
}

describe.each(TARGETS)("requests when $server answers", (target) => {
  it("says which API it speaks and which server answers", () => {
    const { client } = build(target, [{}]);
    expect(client.shape).toBe("google");
    expect(client.server).toBe(target.server);
  });

  it("places.searchText posts the body and sends the field mask as a header", async () => {
    const { client, fetch } = build(target, [{ body: textSearch }]);
    const answer = await client.places.searchText({
      fieldMask: ["places.displayName", "places.formattedAddress", "places.priceLevel"],
      textQuery: "vegetarian food in Sydney",
      languageCode: "en",
      pageSize: 2,
      priceLevels: ["PRICE_LEVEL_MODERATE"],
      locationBias: {
        circle: { center: { latitude: -33.87, longitude: 151.21 }, radius: 500 },
      },
      openNow: undefined,
    });
    expect(answer).toEqual(textSearch);
    expect(methodOf(fetch)).toBe("POST");
    expect(String(fetch.mock.calls[0]![0])).toBe(`${target.places}/v1/places:searchText`);
    expect(headersOf(fetch)).toMatchObject({
      "content-type": "application/json",
      "x-goog-fieldmask": "places.displayName,places.formattedAddress,places.priceLevel",
    });
    // The mask travels in the header only, and a parameter left undefined is not sent.
    expect(bodyOf(fetch)).toEqual({
      textQuery: "vegetarian food in Sydney",
      languageCode: "en",
      pageSize: 2,
      priceLevels: ["PRICE_LEVEL_MODERATE"],
      locationBias: {
        circle: { center: { latitude: -33.87, longitude: 151.21 }, radius: 500 },
      },
    });
    expectCredential(target, fetch);
  });

  it("places.autocomplete posts the body, with no field mask unless one is given", async () => {
    const { client, fetch } = build(target, [{ body: autocompleteOrigin }]);
    const answer = await client.places.autocomplete({
      input: "Amoeba",
      origin: { latitude: 37.76999, longitude: -122.44696 },
      includedRegionCodes: ["us"],
      sessionToken: "session-1",
    });
    expect(answer).toEqual(autocompleteOrigin);
    expect(methodOf(fetch)).toBe("POST");
    expect(String(fetch.mock.calls[0]![0])).toBe(`${target.places}/v1/places:autocomplete`);
    expect(headersOf(fetch)).not.toHaveProperty("x-goog-fieldmask");
    expect(headersOf(fetch)["content-type"]).toBe("application/json");
    expect(bodyOf(fetch)).toEqual({
      input: "Amoeba",
      origin: { latitude: 37.76999, longitude: -122.44696 },
      includedRegionCodes: ["us"],
      sessionToken: "session-1",
    });
    expectCredential(target, fetch);

    const second = build(target, [{ body: autocompleteArt }]);
    await expect(
      second.client.places.autocomplete({
        input: "Art museum",
        fieldMask: ["suggestions.placePrediction.text.text", "suggestions.placePrediction.placeId"],
      }),
    ).resolves.toEqual(autocompleteArt);
    expect(headersOf(second.fetch)["x-goog-fieldmask"]).toBe(
      "suggestions.placePrediction.text.text,suggestions.placePrediction.placeId",
    );
    expect(bodyOf(second.fetch)).toEqual({ input: "Art museum" });
  });

  it("places.get puts the resource name in the path and the rest in the query", async () => {
    const { client, fetch } = build(target, [{ body: placeDetails }]);
    const answer = await client.places.get({
      name: `places/${PLACE_ID}`,
      fieldMask: ["id", "displayName", "formattedAddress", "plusCode"],
      languageCode: "en",
      regionCode: "us",
      sessionToken: "session-1",
    });
    expect(answer).toEqual(placeDetails);
    expect(methodOf(fetch)).toBe("GET");
    expect(hasBody(fetch)).toBe(false);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.places}/v1/places/${PLACE_ID}?languageCode=en&regionCode=us&sessionToken=session-1`,
    );
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe("id,displayName,formattedAddress,plusCode");
    expectCredential(target, fetch);
  });

  it("places.get returns a moved place as it came", async () => {
    const { client, fetch } = build(target, [{ body: placeDetailsMoved }]);
    await expect(
      client.places.get({ name: "places/ChIJUfQdGInVzkwRzAjmjzWB7CQ", fieldMask: ["*"] }),
    ).resolves.toEqual(placeDetailsMoved);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.places}/v1/places/ChIJUfQdGInVzkwRzAjmjzWB7CQ`,
    );
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe("*");
  });

  it("places.searchNearby posts the body and sends the field mask as a header", async () => {
    const { client, fetch } = build(target, [{ body: nearbySearch }]);
    const params = {
      fieldMask: ["places.id", "places.displayName", "places.entrances"],
      locationRestriction: {
        circle: { center: { latitude: 37.6213, longitude: -122.379 }, radius: 1000 },
      },
      includedTypes: ["airport"],
      maxResultCount: 1,
      rankPreference: "DISTANCE",
    } as const;
    const answer = await client.places.searchNearby(params);
    expect(answer).toEqual(nearbySearch);
    expect(methodOf(fetch)).toBe("POST");
    expect(String(fetch.mock.calls[0]![0])).toBe(`${target.places}/v1/places:searchNearby`);
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe(
      "places.id,places.displayName,places.entrances",
    );
    const { fieldMask: _mask, ...body } = params;
    expect(bodyOf(fetch)).toEqual(body);
    expectCredential(target, fetch);
  });

  it("geocode.address puts the address text in the path", async () => {
    const { client, fetch } = build(target, [{ body: geocodeAddress }]);
    const answer = await client.geocode.address({
      addressQuery: "1600 Amphitheatre Parkway, Mountain View, CA",
      languageCode: "en",
      regionCode: "us",
      locationBias: {
        rectangle: {
          low: { latitude: 36.47, longitude: -84.72 },
          high: { latitude: 43.39, longitude: -65.9 },
        },
      },
      fieldMask: ["results.placeId", "results.location"],
    });
    expect(answer).toEqual(geocodeAddress);
    expect(methodOf(fetch)).toBe("GET");
    expect(hasBody(fetch)).toBe(false);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/address/1600%20Amphitheatre%20Parkway,%20Mountain%20View,%20CA` +
        "?languageCode=en&regionCode=us" +
        "&locationBias.rectangle.low.latitude=36.47&locationBias.rectangle.low.longitude=-84.72" +
        "&locationBias.rectangle.high.latitude=43.39&locationBias.rectangle.high.longitude=-65.9",
    );
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe("results.placeId,results.location");
    expectCredential(target, fetch);
  });

  it("geocode.address encodes what would break a path segment", async () => {
    const { client, fetch } = build(target, [{ body: {} }]);
    await client.geocode.address({ addressQuery: "849VCWC8+R4" });
    await client.geocode.address({ addressQuery: "1/2 Main St #4?" });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/address/849VCWC8%2BR4`,
    );
    expect(String(fetch.mock.calls[1]![0])).toBe(
      `${target.geocode}/v4/geocode/address/1%2F2%20Main%20St%20%234%3F`,
    );
    expect(headersOf(fetch)).not.toHaveProperty("x-goog-fieldmask");
  });

  it("geocode.address sends a text that cannot be a path segment in the query", async () => {
    const { client, fetch } = build(target, [{ body: {} }]);
    await client.geocode.address({ addressQuery: "..", regionCode: "mc" });
    await client.geocode.address({ addressQuery: "" });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/address?addressQuery=..&regionCode=mc`,
    );
    expect(String(fetch.mock.calls[1]![0])).toBe(
      `${target.geocode}/v4/geocode/address?addressQuery=`,
    );
  });

  it("geocode.address sends an address in parts as dotted parameters", async () => {
    const { client, fetch } = build(target, [{ body: geocodeAddress }]);
    await client.geocode.address({
      address: {
        addressLines: ["1600 Amphitheatre Pkwy", "Building 41"],
        locality: "Mountain View",
        administrativeArea: "CA",
        postalCode: "94043",
        regionCode: "US",
      },
      languageCode: "en",
    });
    expect(methodOf(fetch)).toBe("GET");
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/address` +
        "?address.addressLines=1600+Amphitheatre+Pkwy&address.addressLines=Building+41" +
        "&address.locality=Mountain+View&address.administrativeArea=CA" +
        "&address.postalCode=94043&address.regionCode=US&languageCode=en",
    );
    expectCredential(target, fetch);
  });

  it("geocode.location puts the point in the path and repeats the keys of a list", async () => {
    const { client, fetch } = build(target, [{ body: reverseLocation }]);
    const answer = await client.geocode.location({
      locationQuery: "37.4225508,-122.0846338",
      languageCode: "en",
      types: ["street_address", "locality"],
      granularity: ["ROOFTOP", "GEOMETRIC_CENTER"],
      fieldMask: ["results.formattedAddress", "plusCode"],
    });
    expect(answer).toEqual(reverseLocation);
    expect(methodOf(fetch)).toBe("GET");
    expect(hasBody(fetch)).toBe(false);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/location/37.4225508,-122.0846338` +
        "?languageCode=en&types=street_address&types=locality" +
        "&granularity=ROOFTOP&granularity=GEOMETRIC_CENTER",
    );
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe("results.formattedAddress,plusCode");
    expectCredential(target, fetch);
  });

  it("geocode.location sends a point in parts as dotted parameters", async () => {
    const { client, fetch } = build(target, [{ body: reverseLocation }]);
    await client.geocode.location({
      location: { latitude: 37.4225508, longitude: -122.0846338 },
      regionCode: "us",
    });
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/location` +
        "?location.latitude=37.4225508&location.longitude=-122.0846338&regionCode=us",
    );
  });

  it("geocode.place puts the resource name in the path", async () => {
    const result = (geocodeAddress.results as unknown[])[0];
    const { client, fetch } = build(target, [{ body: result }]);
    const answer = await client.geocode.place({
      place: `places/${PLACE_ID}`,
      languageCode: "en",
      regionCode: "us",
      fieldMask: ["formattedAddress", "location"],
    });
    expect(answer).toEqual(result);
    expect(methodOf(fetch)).toBe("GET");
    expect(hasBody(fetch)).toBe(false);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.geocode}/v4/geocode/places/${PLACE_ID}?languageCode=en&regionCode=us`,
    );
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe("formattedAddress,location");
    expectCredential(target, fetch);
  });

  it("places.getPhotoMedia puts the name in the path and asks for the URI, not a redirect", async () => {
    const media = {
      name: `places/${PLACE_ID}/photos/photo-1/media`,
      photoUri: "https://photos.example/photo-1",
    };
    const { client, fetch } = build(target, [{ body: media }]);
    const answer = await client.places.getPhotoMedia({
      name: `places/${PLACE_ID}/photos/photo-1/media`,
      maxWidthPx: 400,
    });
    expect(answer).toEqual(media);
    expect(methodOf(fetch)).toBe("GET");
    expect(hasBody(fetch)).toBe(false);
    expect(String(fetch.mock.calls[0]![0])).toBe(
      `${target.places}/v1/places/${PLACE_ID}/photos/photo-1/media?maxWidthPx=400&skipHttpRedirect=true`,
    );
    expect(headersOf(fetch)).not.toHaveProperty("x-goog-fieldmask");
    expectCredential(target, fetch);
  });

  it("geocode.destinations posts the query and sends the field mask as a header", async () => {
    const found = {
      destinations: [
        {
          primary: {
            place: "places/a",
            placeId: "a",
            displayName: { text: "1 Test Street" },
            location: { latitude: 1.5, longitude: 2.5 },
          },
          entrances: [{ location: { latitude: 1.5001, longitude: 2.5 }, tags: ["PREFERRED"] }],
        },
      ],
    };
    const { client, fetch } = build(target, [{ body: found }]);
    const params = {
      addressQuery: { addressQuery: "1 Test Street" },
      languageCode: "en",
      fieldMask: ["destinations.primary", "destinations.entrances"],
    } as const;
    const answer = await client.geocode.destinations(params);
    expect(answer).toEqual(found);
    expect(methodOf(fetch)).toBe("POST");
    expect(String(fetch.mock.calls[0]![0])).toBe(`${target.geocode}/v4/geocode/destinations`);
    expect(headersOf(fetch)["x-goog-fieldmask"]).toBe(
      "destinations.primary,destinations.entrances",
    );
    const { fieldMask: _mask, ...body } = params;
    expect(bodyOf(fetch)).toEqual(body);
    expectCredential(target, fetch);
  });

  it("refuses a resource name that is not one, before any request", async () => {
    const { client, fetch } = build(target, [{ body: {} }]);
    for (const name of [PLACE_ID, "places/", "places/..", "places/a//b", "other/abc"]) {
      const failed = await client.places.get({ name, fieldMask: ["id"] }).catch((e: unknown) => e);
      expect(failed).toBeInstanceOf(GeocoderError);
      expect(failed).toMatchObject({ code: "invalid_request", operation: "places.get" });
    }
    await expect(client.geocode.place({ place: "places/../address" })).rejects.toMatchObject({
      code: "invalid_request",
      operation: "geocode.place",
    });
    for (const name of [
      `places/${PLACE_ID}/photos/p`,
      `places/${PLACE_ID}`,
      "places/a/photos//media",
    ])
      await expect(client.places.getPhotoMedia({ name, maxHeightPx: 10 })).rejects.toMatchObject({
        code: "invalid_request",
        operation: "places.getPhotoMedia",
      });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lets the headers of one call replace the field mask", async () => {
    const { client, fetch } = build(target, [{ body: {} }]);
    await client.places.searchText(
      { textQuery: "casino", fieldMask: ["places.id"] },
      { headers: { "X-Goog-FieldMask": "*", "Accept-Language": "fr" } },
    );
    expect(headersOf(fetch)).toMatchObject({ "x-goog-fieldmask": "*", "accept-language": "fr" });
  });

  it("says how long an answer may be kept", async () => {
    const { client } = build(target, [{ body: geocodeAddress, headers: { "x-request-id": "r1" } }]);
    const outcome = await client.geocode.address({ addressQuery: "Googleplex" }).withResponse();
    expect(outcome.server).toBe(target.server);
    expect(outcome.data).toEqual(geocodeAddress);
    expect(outcome.requestId).toBe("r1");
    expect(outcome.response?.status).toBe(200);
    // Google's answers may be kept 30 days, and og's without limit.
    expect(outcome.cache).toEqual({ maxTtl: target.server === "og" ? Infinity : 30 * DAY });

    const search = build(target, [{ body: textSearch }]);
    const found = await search.client.places
      .searchText({ textQuery: "x", fieldMask: ["*"] })
      .withResponse();
    expect(found.cache).toEqual({ maxTtl: target.server === "og" ? Infinity : 30 * DAY });
  });

  it("maps an error answer to a GeocoderError with the transport error as its cause", async () => {
    const { client } = build(target, [
      { status: 403, body: permissionDenied, headers: { "x-request-id": "req-403" } },
    ]);
    const failed = (await client.places
      .get({ name: `places/${PLACE_ID}`, fieldMask: ["id"] })
      .catch((e: unknown) => e)) as GeocoderError;
    expect(failed).toBeInstanceOf(GeocoderError);
    expect(failed).toMatchObject({
      code: "permission_denied",
      status: 403,
      provider: target.server,
      operation: "places.get",
      requestId: "req-403",
      message: "The request is missing a valid API key.",
      body: permissionDenied,
    });
    expect(failed.cause).toBeInstanceOf(PermissionDeniedError);
    expect(failed.cause).toMatchObject({ status: 403, body: permissionDenied });
    expect((failed.cause as PermissionDeniedError).headers?.get("x-request-id")).toBe("req-403");
  });

  it("reads the error by its status name, where the HTTP status alone would misread it", async () => {
    const cases: [Reply, Partial<GeocoderError>, unknown][] = [
      [{ status: 400, body: invalidArgument }, { code: "invalid_request" }, BadRequestError],
      [
        {
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
        },
        { code: "unauthenticated", message: "API key not valid. Please pass a valid API key." },
        BadRequestError,
      ],
      [
        { status: 404, body: { error: { code: 404, message: "Gone.", status: "NOT_FOUND" } } },
        { code: "not_found" },
        NotFoundError,
      ],
      [
        {
          status: 429,
          body: { error: { code: 429, message: "Quota.", status: "RESOURCE_EXHAUSTED" } },
        },
        { code: "rate_limited", retryable: true },
        RateLimitError,
      ],
      [
        {
          status: 504,
          body: { error: { code: 504, message: "Late.", status: "DEADLINE_EXCEEDED" } },
        },
        { code: "timeout" },
        InternalServerError,
      ],
      [
        {
          status: 501,
          body: { error: { code: 501, message: "Not here.", status: "UNIMPLEMENTED" } },
        },
        { code: "unsupported" },
        InternalServerError,
      ],
      // A body that is not Google's envelope falls back on the HTTP status.
      [{ status: 501, body: "nope" }, { code: "unsupported" }, InternalServerError],
      [{ status: 503, body: {} }, { code: "unavailable" }, InternalServerError],
    ];
    for (const [reply, expected, cause] of cases) {
      const { client } = build(target, [reply], { maxRetries: 0 });
      const failed = (await client.places
        .searchNearby({
          fieldMask: ["places.id"],
          locationRestriction: { circle: { center: { latitude: 1, longitude: 2 }, radius: 3 } },
        })
        .catch((e: unknown) => e)) as GeocoderError;
      expect(failed).toBeInstanceOf(GeocoderError);
      expect(failed).toMatchObject({
        ...expected,
        status: reply.status,
        provider: target.server,
        operation: "places.searchNearby",
      });
      expect(failed.cause).toBeInstanceOf(cause);
    }
  });

  it("does not retry a keystroke, and retries a search", async () => {
    const down: Reply = { status: 503, body: {}, headers: { "retry-after-ms": "1" } };
    const typed = build(target, [down, { body: autocompleteOrigin }]);
    await expect(typed.client.places.autocomplete({ input: "amo" })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(typed.fetch).toHaveBeenCalledTimes(1);

    const asked = build(target, [down, { body: autocompleteOrigin }]);
    await expect(
      asked.client.places.autocomplete({ input: "amo" }, { maxRetries: 1 }),
    ).resolves.toEqual(autocompleteOrigin);
    expect(asked.fetch).toHaveBeenCalledTimes(2);

    const search = build(target, [down, { body: textSearch }]);
    await expect(
      search.client.places.searchText({ textQuery: "x", fieldMask: ["places.id"] }),
    ).resolves.toEqual(textSearch);
    expect(search.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives plugins the points of an answer, in order", async () => {
    const seen: Record<string, Position[]> = {};
    const spy: Plugin = {
      name: "spy",
      async handle(call, next) {
        const outcome = await next();
        seen[call.method] = call.positions(outcome.data);
        return outcome;
      },
    };
    const places = {
      places: [
        { id: "a", location: { latitude: 43.7391605, longitude: 7.428023 } },
        // A place with no location, such as a business that only visits its customers.
        { id: "b" },
        // proto3 JSON leaves out a coordinate that is zero.
        { id: "c", location: { latitude: 5.5 } },
      ],
    };
    const results = {
      results: [
        { placeId: "a", location: { latitude: 43.7377547, longitude: 7.4270688 } },
        { placeId: "b", location: { latitude: 43.7403136, longitude: 7.4260731 } },
      ],
    };
    const one = { id: "a", location: { latitude: 43.7391605, longitude: 7.428023 } };
    const { client } = build(
      target,
      [
        { body: places },
        { body: places },
        { body: one },
        { body: autocompleteOrigin },
        { body: results },
        { body: results },
        { body: one },
        { body: { destinations: [{ primary: one }, {}] } },
        { body: { name: "places/a/photos/p/media" } },
        { body: {} },
      ],
      { plugins: [spy] },
    );
    const circle = { center: { latitude: 43.73, longitude: 7.42 }, radius: 500 };
    await client.places.searchText({ textQuery: "casino", fieldMask: ["*"] });
    await client.places.searchNearby({ fieldMask: ["*"], locationRestriction: { circle } });
    await client.places.get({ name: "places/a", fieldMask: ["*"] });
    await client.places.autocomplete({ input: "cas" });
    await client.geocode.address({ addressQuery: "2 Avenue de Monte-Carlo" });
    await client.geocode.location({ locationQuery: "43.7377547,7.4270688" });
    await client.geocode.place({ place: "places/a" });
    await client.geocode.destinations({ place: "places/a" });
    await client.places.getPhotoMedia({ name: "places/a/photos/p/media", maxWidthPx: 10 });
    const expectedPlaces = [
      { lat: 43.7391605, lon: 7.428023 },
      { lat: 5.5, lon: 0 },
    ];
    const expectedResults = [
      { lat: 43.7377547, lon: 7.4270688 },
      { lat: 43.7403136, lon: 7.4260731 },
    ];
    expect(seen).toEqual({
      "places.searchText": expectedPlaces,
      "places.searchNearby": expectedPlaces,
      "places.get": [{ lat: 43.7391605, lon: 7.428023 }],
      "places.autocomplete": [],
      "geocode.address": expectedResults,
      "geocode.location": expectedResults,
      "geocode.place": [{ lat: 43.7391605, lon: 7.428023 }],
      // A destination with no primary place has no point.
      "geocode.destinations": [{ lat: 43.7391605, lon: 7.428023 }],
      "places.getPhotoMedia": [],
    });
    // An answer with no results has no points.
    await client.geocode.address({ addressQuery: "nowhere" });
    expect(seen["geocode.address"]).toEqual([]);
  });

  it("names every method so a plugin can run the call on another client", async () => {
    const other = build(TARGETS[1]!, [{ body: { from: "other" } }]);
    const reroute: Plugin = {
      name: "reroute",
      handle: (call) => call.run(other.client),
    };
    const { client, fetch } = build(target, [{ body: { from: "first" } }], {
      plugins: [reroute],
    });
    const circle = { center: { latitude: 43.73, longitude: 7.42 }, radius: 500 };
    const options = { headers: { "x-trace": "t1" } };
    const calls: [() => Promise<unknown>, string][] = [
      [
        () => client.places.searchText({ textQuery: "casino", fieldMask: ["places.id"] }, options),
        "/v1/places:searchText",
      ],
      [() => client.places.autocomplete({ input: "cas" }, options), "/v1/places:autocomplete"],
      [
        () => client.places.get({ name: "places/abc", fieldMask: ["id"] }, options),
        "/v1/places/abc",
      ],
      [
        () =>
          client.places.searchNearby(
            { fieldMask: ["places.id"], locationRestriction: { circle } },
            options,
          ),
        "/v1/places:searchNearby",
      ],
      [
        () => client.geocode.address({ addressQuery: "Monaco" }, options),
        "/v4/geocode/address/Monaco",
      ],
      [
        () => client.geocode.location({ locationQuery: "43.7,7.4" }, options),
        "/v4/geocode/location/43.7,7.4",
      ],
      [() => client.geocode.place({ place: "places/abc" }, options), "/v4/geocode/places/abc"],
      [
        () => client.geocode.destinations({ place: "places/abc" }, options),
        "/v4/geocode/destinations",
      ],
      [
        () =>
          client.places.getPhotoMedia(
            { name: "places/abc/photos/p/media", maxHeightPx: 100 },
            options,
          ),
        "/v1/places/abc/photos/p/media",
      ],
    ];
    for (const [index, [run, path]] of calls.entries()) {
      await expect(run()).resolves.toEqual({ from: "other" });
      expect(urlOf(other.fetch, index).pathname).toBe(`/compat/google${path}`);
      expect(headersOf(other.fetch, index)["x-trace"]).toBe("t1");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("google()", () => {
  it("throws with neither an og server nor a key", () => {
    let thrown: unknown;
    try {
      google({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeocoderError);
    expect(thrown).toMatchObject({ code: "invalid_request", provider: "google" });
  });

  it("sends the client's own headers to either server", async () => {
    for (const target of TARGETS) {
      const { client, fetch } = build(target, [{ body: {} }], {
        headers: { authorization: "Bearer gateway" },
      });
      await client.geocode.place({ place: "places/abc" });
      expect(headersOf(fetch)["authorization"]).toBe("Bearer gateway");
    }
  });

  it("reports a failed connection with code connection", async () => {
    const client = google({
      apiKey: KEY,
      maxRetries: 0,
      logLevel: "off",
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(client.geocode.address({ addressQuery: "Monaco" })).rejects.toMatchObject({
      code: "connection",
      provider: "google",
      operation: "geocode.address",
      status: undefined,
    });
  });
});
