/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  BadRequestError,
  Geocoder,
  type GeocoderError,
  OgError,
} from "../src/index.ts";
import { precisely, type PreciselyOptions } from "../src/precisely.ts";
import autocompleteFixture from "./fixtures/precisely/autocomplete-200.json" with { type: "json" };
import submitFixture from "./fixtures/precisely/bulk-submit-202.json" with { type: "json" };
import cancelFixture from "./fixtures/precisely/cancel-200.json" with { type: "json" };
import cancelErrorFixture from "./fixtures/precisely/cancel-400.json" with { type: "json" };
import deleteFileFixture from "./fixtures/precisely/delete-file-200.json" with { type: "json" };
import badRequestFixture from "./fixtures/precisely/error-400.json" with { type: "json" };
import unauthorizedFixture from "./fixtures/precisely/error-401.json" with { type: "json" };
import forbiddenFixture from "./fixtures/precisely/error-403.json" with { type: "json" };
import tooLargeFixture from "./fixtures/precisely/error-413.json" with { type: "json" };
import rateLimitFixture from "./fixtures/precisely/error-429.json" with { type: "json" };
import internalFixture from "./fixtures/precisely/error-500.json" with { type: "json" };
import unavailableFixture from "./fixtures/precisely/error-503.json" with { type: "json" };
import filesFixture from "./fixtures/precisely/files-200.json" with { type: "json" };
import geocodeFixture from "./fixtures/precisely/geocode-200.json" with { type: "json" };
import partialFixture from "./fixtures/precisely/geocode-206.json" with { type: "json" };
import jobStatusFixture from "./fixtures/precisely/job-status-200.json" with { type: "json" };
import jobsFixture from "./fixtures/precisely/jobs-200.json" with { type: "json" };
import lookupFixture from "./fixtures/precisely/lookup-200.json" with { type: "json" };
import reverseFixture from "./fixtures/precisely/reverse-200.json" with { type: "json" };
import tokenFixture from "./fixtures/precisely/token-200.json" with { type: "json" };
import tokenErrorFixture from "./fixtures/precisely/token-400.json" with { type: "json" };
import uploadUrlFixture from "./fixtures/precisely/upload-url-200.json" with { type: "json" };
import verifyFixture from "./fixtures/precisely/verify-200.json" with { type: "json" };
import { type Fetch, fakeFetch, urlOf } from "./helpers.ts";

const HOST = "https://api.cloud.precisely.com";
/** `Apikey` and the base64 of `key:secret`. */
const APIKEY = "Apikey a2V5OnNlY3JldA==";

const adapter = (fetch: typeof globalThis.fetch, options: Partial<PreciselyOptions> = {}) =>
  precisely({
    apiKey: "key",
    apiSecret: "secret",
    fetch,
    logLevel: "off",
    ...options,
  } as PreciselyOptions);
const geocoder = (fetch: typeof globalThis.fetch, options: Partial<PreciselyOptions> = {}) =>
  new Geocoder({ adapter: adapter(fetch, options) });

const initOf = (fetch: Fetch, call = 0): RequestInit => fetch.mock.calls[call]![1]!;
const headersOf = (fetch: Fetch, call = 0) => initOf(fetch, call).headers as Record<string, string>;
const bodyOf = (fetch: Fetch, call = 0) => JSON.parse(String(initOf(fetch, call).body));
const caught = <E extends OgError = GeocoderError>(promise: PromiseLike<unknown>): Promise<E> =>
  Promise.resolve(promise).then(
    () => {
      throw new Error("The call did not fail.");
    },
    (error: E) => error,
  );

const harrowmere = {
  id: "PB_KEY:P0000T7KQ2WX:US",
  type: "address",
  name: "4820 KESTREL BLVD STE 210",
  label: "4820 KESTREL BLVD STE 210, HARROWMERE OH 43917-6042, United States",
  location: { lat: 40.117485, lon: -82.914362 },
  accuracy: "rooftop",
  confidence: null,
  distance: null,
  address: {
    houseNumber: "4820",
    street: "KESTREL",
    unit: "210",
    neighbourhood: null,
    locality: "HARROWMERE",
    district: "VELLACOTT COUNTY",
    region: "Ohio",
    regionCode: "OH",
    postcode: "43917",
    country: "United States",
    countryCode: "US",
  },
};

const quillfield = {
  id: "PB_KEY:P0000W5HN83C:US",
  type: "address",
  name: "9 TALLOWFIELD CT",
  label: "9 TALLOWFIELD CT, QUILLFIELD CO 81194-3406, United States",
  location: { lat: 39.526618, lon: -105.318274 },
  accuracy: "rooftop",
  confidence: null,
  distance: null,
  address: {
    houseNumber: "9",
    street: "TALLOWFIELD",
    unit: null,
    neighbourhood: null,
    locality: "QUILLFIELD",
    district: "MARROWDALE COUNTY",
    region: "Colorado",
    regionCode: "CO",
    postcode: "81194",
    country: "United States",
    countryCode: "US",
  },
};

describe("geocode", () => {
  it("sends free text as an address line and maps the result", async () => {
    const fetch = fakeFetch({ body: geocodeFixture, headers: { "x-request-id": "req-1" } });
    const answer = await geocoder(fetch)
      .geocode("4820 Kestrel Blvd #210 Harrowmere, OH", {
        limit: 3,
        countries: ["us"],
        language: "en",
        bounds: [-84, 39, -82, 41],
        include: ["addressDetails", "addressLines", "match", "highlights"],
      })
      .withResponse();
    expect(initOf(fetch).method).toBe("POST");
    expect(urlOf(fetch).href).toBe(`${HOST}/v1/geocode`);
    expect(headersOf(fetch)).toMatchObject({
      authorization: APIKEY,
      "content-type": "application/json",
    });
    expect(bodyOf(fetch)).toEqual({
      preferences: { maxResults: 3, returnAllInfo: true },
      addresses: [
        { addressId: "0", addressLines: ["4820 Kestrel Blvd #210 Harrowmere, OH"], country: "US" },
      ],
    });
    expect(answer.requestId).toBe("req-1");
    expect(answer.data).toEqual({
      provider: "precisely",
      operation: "geocode",
      results: [
        {
          ...harrowmere,
          addressDetails: {
            unitType: "STE",
            building: null,
            floor: null,
            sublocality: null,
            postcodeSuffix: "6042",
          },
          addressLines: ["4820 KESTREL BLVD STE 210", "HARROWMERE OH 43917-6042", "United States"],
          match: {
            score: 0.93,
            label: null,
            components: {
              houseNumber: "matched",
              region: "matched",
              district: "unmatched",
              locality: "matched",
              street: "matched",
              postcode: "unmatched",
              unit: "unmatched",
            },
          },
          highlights: null,
        },
      ],
      // Precisely's public documentation states no credit a customer must show with a result, so none is made up.
      attribution: [],
      unavailable: ["confidence", "distance", "highlights"],
      ignored: ["language", "bounds"],
    });
  });

  it("sends a structured address as discrete fields", async () => {
    const fetch = fakeFetch({ body: geocodeFixture });
    const answer = await geocoder(fetch).geocode({
      houseNumber: "4820",
      street: "Kestrel Blvd",
      locality: "Harrowmere",
      region: "OH",
      postcode: "43917",
      country: "USA",
    });
    expect(bodyOf(fetch)).toEqual({
      preferences: { returnAllInfo: true },
      addresses: [
        {
          addressId: "0",
          addressNumber: "4820",
          street: "Kestrel Blvd",
          city: "Harrowmere",
          admin1: "OH",
          postalCode: "43917",
          country: "USA",
        },
      ],
    });
    expect(answer.ignored).toEqual([]);
    expect(answer.results).toEqual([harrowmere]);
  });

  it("sends a structured street line as an address line, and falls back to the default country", async () => {
    const fetch = fakeFetch({ body: geocodeFixture });
    await geocoder(fetch, { defaultCountry: "USA" }).geocode({
      address: "4820 Kestrel Blvd #210",
      locality: "Harrowmere",
    });
    expect(bodyOf(fetch).addresses).toEqual([
      {
        addressId: "0",
        addressLines: ["4820 Kestrel Blvd #210"],
        city: "Harrowmere",
        country: "USA",
      },
    ]);
  });

  it("returns the raw record and body when asked", async () => {
    const answer = await geocoder(fakeFetch({ body: geocodeFixture })).geocode("x", {
      countries: ["US"],
      include: ["raw"],
    });
    expect(answer.raw).toEqual(geocodeFixture);
    expect(answer.results[0]!.raw).toEqual(geocodeFixture.responses[0]!.results[0]);
  });

  it("answers nothing for ZERO_RESULTS", async () => {
    const fetch = fakeFetch({ body: { responses: [{ addressId: "0", status: "ZERO_RESULTS" }] } });
    const answer = await geocoder(fetch).geocode("nowhere", { countries: ["US"] });
    expect(answer.results).toEqual([]);
  });

  it("fails without a country, before any request", async () => {
    const fetch = fakeFetch({ body: geocodeFixture });
    const error = await caught(geocoder(fetch).geocode("4820 Kestrel Blvd"));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/^Precisely needs a country\./);
    expect(error.operation).toBe("geocode");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses more than one country", async () => {
    const fetch = fakeFetch({ body: geocodeFixture });
    const error = await caught(geocoder(fetch).geocode("x", { countries: ["US", "CA"] }));
    expect(error.code).toBe("unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a bearer token from a function", async () => {
    const fetch = fakeFetch({ body: geocodeFixture });
    const token = vi.fn(async () => "jwt");
    const geo = new Geocoder({
      adapter: precisely({ token, fetch, logLevel: "off", baseUrl: "https://proxy.test/geo/" }),
    });
    await geo.geocode("x", { countries: ["US"] });
    expect(urlOf(fetch).href).toBe("https://proxy.test/geo/v1/geocode");
    expect(headersOf(fetch).authorization).toBe("Bearer jwt");
    expect(token).toHaveBeenCalledTimes(1);
  });
});

describe("reverse", () => {
  it("sends the point with the default country and maps the result", async () => {
    const fetch = fakeFetch({ body: reverseFixture });
    const answer = await geocoder(fetch, { defaultCountry: "USA" }).reverse(
      { lat: 39.52688, lon: -105.31854 },
      { limit: 1, include: ["addressDetails", "match"] },
    );
    expect(urlOf(fetch).href).toBe(`${HOST}/v1/reverse-geocode`);
    expect(bodyOf(fetch)).toEqual({
      preferences: { maxResults: 1, returnAllInfo: true },
      locations: [{ addressId: "0", longitude: -105.31854, latitude: 39.52688, country: "USA" }],
    });
    expect(answer.results).toEqual([
      {
        ...quillfield,
        distance: 36.981300000000005,
        addressDetails: {
          unitType: null,
          building: null,
          floor: null,
          sublocality: null,
          postcodeSuffix: "3406",
        },
        match: null,
      },
    ]);
    expect(answer.unavailable).toEqual(["confidence", "match"]);
  });

  it("fails without a country", async () => {
    const error = await caught(geocoder(fakeFetch({})).reverse({ lat: 39, lon: -105 }));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/^Precisely needs a country\./);
  });
});

describe("autocomplete", () => {
  const session = "6f2c81d4-3b7a-4e59-9c10-d2a45b8e7f31";

  it("sends the origin and the transaction ID, and maps predictions with their location", async () => {
    const fetch = fakeFetch({ body: autocompleteFixture });
    const geo = geocoder(fetch);
    expect(geo.capabilities.autocomplete?.coordinates).toBe(true);
    const answer = await geo.autocomplete("615 Wrenlow", {
      limit: 2,
      countries: ["US"],
      focus: { lat: 44.3, lon: -89.7 },
      session,
      include: ["highlights", "match", "addressLines"],
    });
    expect(urlOf(fetch).href).toBe(`${HOST}/v1/autocomplete`);
    expect(headersOf(fetch)).toMatchObject({
      authorization: APIKEY,
      "x-transaction-id": session,
    });
    expect(bodyOf(fetch)).toEqual({
      preferences: { maxResults: 2, returnAllInfo: true, originXY: [-89.7, 44.3] },
      address: { addressLines: ["615 Wrenlow"], country: "US" },
    });
    expect(answer.results).toHaveLength(2);
    expect(answer.results[0]).toEqual({
      id: "PB_KEY:P0000M3XD71H:USA",
      type: "unknown",
      name: "615 Wrenlow Ave",
      label: "615 Wrenlow Ave, Tannery Fold WI 54193",
      location: { lat: 44.318639999999995, lon: -89.73128 },
      accuracy: null,
      confidence: null,
      distance: 3240,
      address: {
        houseNumber: "615",
        street: "Wrenlow Ave",
        unit: null,
        neighbourhood: null,
        locality: "Tannery Fold",
        district: null,
        region: "WI",
        regionCode: "WI",
        postcode: "54193",
        country: null,
        countryCode: "US",
      },
      // `WRENLOW` is what was typed, but the label spells it `Wrenlow`, so only `615` can be placed.
      highlights: [{ start: 0, end: 3 }],
      match: {
        score: null,
        label: null,
        components: {
          houseNumber: "matched",
          region: "unmatched",
          district: "unmatched",
          locality: "unmatched",
          street: "partial",
          postcode: "unmatched",
        },
      },
      addressLines: ["615 Wrenlow Ave", "Tannery Fold WI 54193"],
    });
    expect(answer.results[1]!.id).toBe("PB_KEY:P00009RVK4TB:USA");
    expect(answer.unavailable).toEqual(["confidence"]);
    expect(answer.ignored).toEqual([]);
  });

  it("asks for five suggestions by default, and leaves out a distance with no origin", async () => {
    const fetch = fakeFetch({ body: autocompleteFixture });
    const answer = await geocoder(fetch, { defaultCountry: "USA" }).autocomplete("615 Wrenlow");
    expect(bodyOf(fetch).preferences).toEqual({ maxResults: 5, returnAllInfo: true });
    expect(answer.results.map((place) => place.distance)).toEqual([null, null]);
  });

  it("converts the distance to metres", async () => {
    const body = structuredClone(autocompleteFixture);
    body.response.predictions[0]!.distance = { value: 3, distanceUnit: "MILE" };
    body.response.predictions[1]!.distance = { value: 40, distanceUnit: "FOOT" };
    const answer = await geocoder(fakeFetch({ body })).autocomplete("615 Wrenlow", {
      countries: ["US"],
      focus: { lat: 44.3, lon: -89.7 },
    });
    expect(answer.results.map((place) => place.distance)).toEqual([4828.032, 12.192]);
  });

  it("does not send a session that is not a UUID", async () => {
    const fetch = fakeFetch({ body: autocompleteFixture });
    await geocoder(fetch).autocomplete("615", { countries: ["US"], session: "keystrokes-1" });
    expect(headersOf(fetch)).not.toHaveProperty("x-transaction-id");
  });

  it("turns a failed status in the body into an error", async () => {
    const response = {
      status: "INVALID_REQUEST",
      errorMessage: "The request could not be read (DIS-LI-1018)",
    };
    const error = await caught(
      geocoder(fakeFetch({ body: { response } })).autocomplete("x", { countries: ["US"] }),
    );
    expect(error.code).toBe("invalid_request");
    expect(error.message).toBe("The request could not be read (DIS-LI-1018)");
    expect(error.cause).toBeInstanceOf(BadRequestError);
  });
});

describe("lookup", () => {
  it("decodes the ID into a key, its type and its country", async () => {
    const fetch = fakeFetch({ body: lookupFixture });
    const answer = await geocoder(fetch).lookup("PB_KEY:P0000W5HN83C:US", { include: ["raw"] });
    expect(urlOf(fetch).href).toBe(`${HOST}/v1/lookup`);
    expect(bodyOf(fetch)).toEqual({
      preferences: { returnAllInfo: true },
      keys: [{ key: "P0000W5HN83C", type: "PB_KEY", country: "US" }],
    });
    expect(answer.results).toEqual([
      { ...quillfield, raw: lookupFixture.responses[0]!.results[0] },
    ]);
    expect(answer.raw).toEqual(lookupFixture);
    expect(answer.unavailable).toEqual(["confidence", "distance"]);
  });

  it("takes back the ID an earlier result carried", async () => {
    const fetch = fakeFetch({ body: autocompleteFixture }, { body: lookupFixture });
    const geo = geocoder(fetch);
    const suggested = await geo.autocomplete("615 Wrenlow", { countries: ["US"] });
    await geo.lookup(suggested.results[0]!.id!);
    expect(bodyOf(fetch, 1).keys).toEqual([
      { key: "P0000M3XD71H", type: "PB_KEY", country: "USA" },
    ]);
  });

  it("uses the default country for an ID that names none", async () => {
    const fetch = fakeFetch({ body: lookupFixture });
    await geocoder(fetch, { defaultCountry: "AUS" }).lookup(["GNAF_PID:GANSW706284915", "nope"]);
    expect(bodyOf(fetch).keys).toEqual([
      { key: "GANSW706284915", type: "GNAF_PID", country: "AUS" },
    ]);
    const error = await caught(geocoder(fetch).lookup("GNAF_PID:GANSW706284915"));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/^Precisely needs a country\./);
  });

  it("answers nothing for an unknown ID", async () => {
    const fetch = fakeFetch({ body: { responses: [{ status: "ZERO_RESULTS" }] } });
    const geo = geocoder(fetch);
    expect((await geo.lookup("not-a-precisely-id")).results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect((await geo.lookup("PB_KEY:P000000000000:US")).results).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sets a null ID on a result with no lookup key", async () => {
    const body = structuredClone(geocodeFixture);
    delete (body.responses[0]!.results[0]!.customFields as { PB_KEY?: string }).PB_KEY;
    const answer = await geocoder(fakeFetch({ body })).geocode("x", { countries: ["US"] });
    expect(answer.results[0]!.id).toBeNull();
  });
});

describe("errors", () => {
  it.each([
    [400, badRequestFixture, "invalid_request", "The country QQQ is not recognised (DIS-LI-1016)"],
    [401, unauthorizedFixture, "unauthenticated", "The credentials were not accepted (DIS-1001)"],
    [403, forbiddenFixture, "permission_denied", "This account may not call this API (DIS-1002)"],
    [
      413,
      tooLargeFixture,
      "payload_too_large",
      "A request may carry at most 25 items (DIS-LI-1014)",
    ],
    [429, rateLimitFixture, "rate_limited", "Too many requests in the current window (DIS-1005)"],
    [
      500,
      internalFixture,
      "provider_error",
      "An internal service failed. Try again later (DIS-1003)",
    ],
    [
      503,
      unavailableFixture,
      "unavailable",
      "The service is not available at the moment (DIS-LI-1011)",
    ],
  ] as const)("maps HTTP %i to a GeocoderError", async (status, body, code, message) => {
    const fetch = fakeFetch({ status, body, headers: { "x-request-id": "req-9" } });
    const error = await caught(geocoder(fetch).geocode("x", { countries: ["US"], maxRetries: 0 }));
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.provider).toBe("precisely");
    expect(error.operation).toBe("geocode");
    expect(error.status).toBe(status);
    expect(error.requestId).toBe("req-9");
    expect(error.cause).toBeInstanceOf(OgError);
    expect((error.cause as OgError).body).toEqual(body);
  });

  it("reads the status word where the HTTP status misleads", async () => {
    const wrong = await caught(
      geocoder(fakeFetch({ status: 400, body: unauthorizedFixture })).geocode("x", {
        countries: ["US"],
      }),
    );
    expect(wrong.code).toBe("unauthenticated");
    const quota = {
      errors: [
        {
          status: "FORBIDDEN",
          errorMessage: "The trial quota is used up and no more requests are accepted (DIS-1007)",
        },
      ],
    };
    const spent = await caught(
      geocoder(fakeFetch({ status: 403, body: quota })).geocode("x", { countries: ["US"] }),
    );
    expect(spent.code).toBe("rate_limited");
  });

  it("fails a single geocode whose item failed in a 206", async () => {
    const [failed] = partialFixture.responses;
    const error = await caught(
      geocoder(fakeFetch({ status: 206, body: { responses: [failed] } })).geocode("x", {
        countries: ["US"],
      }),
    );
    expect(error.code).toBe("invalid_request");
    expect(error.message).toBe("The country QQQ is not recognised (DIS-LI-1016)");
    expect(error.cause).toBeInstanceOf(BadRequestError);
    expect((error.cause as OgError).body).toEqual(failed);
  });
});

describe("batch", () => {
  it("runs geocodes through the realtime endpoint and keeps a failed item apart", async () => {
    const fetch = fakeFetch({ status: 206, body: partialFixture });
    const progress: { done: number; total: number }[] = [];
    const geo = geocoder(fetch);
    expect(geo.capabilities.batch).toEqual({ geocode: "native", reverse: "native" });
    const answer = await geo.batch.geocode(
      [
        "an address with no country",
        { address: { address: "1 Nowhere St", country: "QQQ" } },
        {
          id: "b",
          address: { address: "4820 Kestrel Blvd #210", locality: "Harrowmere", country: "USA" },
        },
      ],
      { limit: 1, onProgress: (step) => progress.push(step) },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(fetch).href).toBe(`${HOST}/v1/geocode`);
    expect(bodyOf(fetch)).toEqual({
      preferences: { maxResults: 1, returnAllInfo: true },
      addresses: [
        { addressId: "1", addressLines: ["1 Nowhere St"], country: "QQQ" },
        {
          addressId: "2",
          addressLines: ["4820 Kestrel Blvd #210"],
          city: "Harrowmere",
          country: "USA",
        },
      ],
    });
    expect(answer).toMatchObject({
      provider: "precisely",
      operation: "batch.geocode",
      mode: "native",
      summary: { total: 3, succeeded: 1, failed: 2 },
      unavailable: ["confidence", "distance"],
      ignored: [],
    });
    const [missing, failed, found] = answer.items;
    expect(missing!.error!.code).toBe("invalid_request");
    expect(missing!.error!.message).toMatch(/^Precisely needs a country\./);
    expect(failed).toMatchObject({ index: 1, id: null, results: [] });
    expect(failed!.error!.code).toBe("invalid_request");
    expect(failed!.error!.message).toBe("The country QQQ is not recognised (DIS-LI-1016)");
    expect(failed!.error!.cause).toBeInstanceOf(BadRequestError);
    expect((failed!.error!.cause as OgError).body).toEqual(partialFixture.responses[0]);
    expect(found).toEqual({ index: 2, id: "b", results: [harrowmere], error: null });
    expect(progress).toEqual([
      { done: 1, total: 3 },
      { done: 3, total: 3 },
    ]);
  });

  it("splits reverse points into requests of 25, and fails only the chunk that failed", async () => {
    const sizes: number[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { locations } = JSON.parse(String(init!.body)) as {
        locations: { addressId: string; country: string }[];
      };
      sizes.push(locations.length);
      if (locations.length < 25) return Response.json(internalFixture, { status: 500 });
      return Response.json({
        responses: locations.map(({ addressId }) =>
          addressId === "3"
            ? { addressId, status: "OK", results: reverseFixture.responses[0]!.results }
            : { addressId, status: "ZERO_RESULTS" },
        ),
      });
    });
    const points = Array.from({ length: 30 }, (_, index) => ({ lat: 39 + index / 100, lon: -105 }));
    const answer = await geocoder(fetch).batch.reverse(points, {
      countries: ["US"],
      concurrency: 1,
      maxRetries: 0,
    });
    expect(sizes).toEqual([25, 5]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body)).locations[0]).toEqual({
      addressId: "25",
      longitude: -105,
      latitude: 39.25,
      country: "US",
    });
    expect(answer.summary).toEqual({ total: 30, succeeded: 25, failed: 5 });
    expect(answer.items[3]!.results).toEqual([{ ...quillfield, distance: 36.981300000000005 }]);
    expect(answer.items[4]).toEqual({ index: 4, id: null, results: [], error: null });
    expect(answer.items[29]!.error!.code).toBe("provider_error");
  });
});

describe("native", () => {
  it("sends any request with the credentials", async () => {
    const fetch = fakeFetch({ body: verifyFixture });
    const { native } = geocoder(fetch, { headers: { "x-gateway": "g" } });
    const body = { addresses: [{ addressLines: ["4820 Kestrel Blvd"], country: "USA" }] };
    expect(await native.request({ path: "/v1/verify", body })).toEqual(verifyFixture);
    expect(await native.verify(body)).toEqual(verifyFixture);
    for (const call of [0, 1]) {
      expect(urlOf(fetch, call).href).toBe(`${HOST}/v1/verify`);
      expect(initOf(fetch, call).method).toBe("POST");
      expect(headersOf(fetch, call)).toMatchObject({ authorization: APIKEY, "x-gateway": "g" });
      expect(bodyOf(fetch, call)).toEqual(body);
    }
  });

  it("trades the key and secret for a token", async () => {
    const fetch = fakeFetch({ body: tokenFixture });
    const token = await adapter(fetch, { authBaseUrl: "https://auth.test/" }).native.token();
    expect(token).toEqual(tokenFixture);
    expect(urlOf(fetch).href).toBe("https://auth.test/auth/v2/token");
    expect(initOf(fetch).method).toBe("POST");
    expect(initOf(fetch).body).toBe("grant_type=client_credentials&scope=default");
    expect(headersOf(fetch)).toMatchObject({
      authorization: "Basic a2V5OnNlY3JldA==",
      "content-type": "application/x-www-form-urlencoded",
    });
  });

  it("reports a token error in Precisely's words", async () => {
    const fetch = fakeFetch({ status: 400, body: tokenErrorFixture });
    const error = await caught<OgError>(adapter(fetch).native.token());
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe("The key and secret are missing (DIS-AUTH-1020)");
    expect(() => precisely({ token: "jwt", fetch }).native.token()).toThrow(OgError);
  });

  it("runs the bulk file flow", async () => {
    const fetch = fakeFetch(
      { body: uploadUrlFixture },
      { body: "" },
      { status: 202, body: submitFixture },
      { status: 202, body: submitFixture },
      { body: jobStatusFixture },
      { body: cancelFixture },
      { body: jobsFixture },
      { body: filesFixture },
      { body: deleteFileFixture },
    );
    const { bulk } = adapter(fetch, {
      bulkBaseUrl: "https://bulk.test",
      headers: { "x-gateway": "g" },
    }).native;
    const file = await bulk.uploadUrl("harbour_batch");
    expect(file).toEqual(uploadUrlFixture);
    await bulk.upload(file.url, "addressId|address|country\n1|12 Tannery Row Harrowmere|GBR\n");
    const preferences = { maxResults: 1 };
    const job = await bulk.geocode({ fileId: file.fileId, delimiter: "|", preferences });
    expect(job).toEqual(submitFixture);
    await bulk.verify({ fileId: file.fileId }, { cassFlow: "no_report" });
    expect(await bulk.status(job.statusUrl)).toEqual(jobStatusFixture);
    expect(await bulk.cancel("c15a8f72-6b3e-4d09-91f4-2e7d0a6b38c5")).toEqual(cancelFixture);
    expect(await bulk.jobs("running")).toEqual(jobsFixture);
    expect(await bulk.files()).toEqual(filesFixture);
    expect(await bulk.deleteFile(file.fileId)).toEqual(deleteFileFixture);

    const sent = fetch.mock.calls.map(([url, init]) => `${init!.method} ${String(url)}`);
    expect(sent).toEqual([
      "POST https://bulk.test/v2/files/upload-url",
      `PUT ${uploadUrlFixture.url}`,
      "POST https://bulk.test/v2/bulk-geocode",
      "POST https://bulk.test/v2/bulk-verify",
      "GET https://bulk.test/v2/bulk/jobs/7e2b94c1-05da-4f36-8a17-c3d6f0b952e8",
      "DELETE https://bulk.test/v2/bulk/jobs/c15a8f72-6b3e-4d09-91f4-2e7d0a6b38c5",
      "GET https://bulk.test/v2/bulk/jobs?status=running",
      "GET https://bulk.test/v2/files",
      `DELETE https://bulk.test/v2/files/${uploadUrlFixture.fileId}`,
    ]);
    expect(bodyOf(fetch, 0)).toEqual({ fileName: "harbour_batch" });
    expect(headersOf(fetch, 0)).toMatchObject({ authorization: APIKEY, "x-gateway": "g" });
    // The storage host gets the file and its content type, and no Precisely credentials.
    expect(initOf(fetch, 1).body).toBe(
      "addressId|address|country\n1|12 Tannery Row Harrowmere|GBR\n",
    );
    expect(headersOf(fetch, 1)).toEqual({ accept: "application/json", "content-type": "text/csv" });
    expect(bodyOf(fetch, 2)).toEqual({ fileId: file.fileId, delimiter: "|", preferences });
    expect(headersOf(fetch, 3)).toMatchObject({
      authorization: APIKEY,
      "x-cass-flow": "no_report",
    });
  });

  it("throws the typed error of a failed bulk call", async () => {
    const fetch = fakeFetch({ status: 400, body: cancelErrorFixture });
    const error = await caught<OgError>(adapter(fetch).native.bulk.cancel("nope"));
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toBe("The job ID is not valid (DIS-LI-1051)");
    expect(error).not.toBeInstanceOf(AuthenticationError);
  });
});

const key = process.env.PRECISELY_API_KEY;
const secret = process.env.PRECISELY_API_SECRET;

const live = () =>
  new Geocoder({
    adapter: precisely({ apiKey: key!, apiSecret: secret!, defaultCountry: "USA" }),
  });
const shaped = (place: { name: string; label: string; address: object } | undefined) => {
  expect(place).toBeDefined();
  expect(typeof place!.name).toBe("string");
  expect(typeof place!.label).toBe("string");
  expect(Object.keys(place!.address)).toHaveLength(11);
};

it("lets a cache keep none of Precisely's answers until its terms are checked", () => {
  const geo = geocoder(fakeFetch({ body: {} }));
  expect(geo.capabilities.cache).toEqual({ maxTtl: 0 });
});

describe.skipIf(!key || !secret)("live", () => {
  it("geocodes", async () => {
    const answer = await live().geocode("4820 Kestrel Blvd #210 Harrowmere, OH");
    expect(answer.provider).toBe("precisely");
    shaped(answer.results[0]);
    expect(answer.results[0]!.location).toEqual({
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
  });

  it("reverse geocodes", async () => {
    const answer = await live().reverse({ lat: 39.52688, lon: -105.31854 });
    shaped(answer.results[0]);
  });

  it("suggests, and looks a suggestion up", async () => {
    const geo = live();
    const session = crypto.randomUUID();
    const suggested = await geo.autocomplete("615 Wrenlow", { limit: 2, session });
    shaped(suggested.results[0]);
    const id = suggested.results.find((place) => place.id !== null)?.id;
    if (id) shaped((await geo.lookup(id)).results[0]);
  });

  it("geocodes a batch", async () => {
    const answer = await live().batch.geocode([
      "4820 Kestrel Blvd, Harrowmere, OH",
      "9 Tallowfield Ct, Quillfield, CO",
    ]);
    expect(answer.mode).toBe("native");
    expect(answer.items).toHaveLength(2);
  });

  it("issues a token", async () => {
    const token = await live().native.token();
    expect(typeof token.access_token).toBe("string");
    expect(typeof token.expires_in).toBe("number");
  });
});
