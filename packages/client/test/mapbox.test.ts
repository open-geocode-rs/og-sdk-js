/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import type { APIPromise } from "../src/core.ts";
import { AuthenticationError, GeocoderError, UnprocessableEntityError } from "../src/errors.ts";
import {
  type GeocodingBatchResponse,
  type GeocodingResponse,
  mapbox,
  type MapboxClient,
  type SearchBoxListCategoriesResponse,
  type SearchBoxResponse,
  type SearchBoxSuggestResponse,
} from "../src/mapbox.ts";
import { bodyOf, type Fetch, fakeFetch, headersOf, urlOf } from "./helpers.ts";

/** A synthetic response in the shape Mapbox documents. */
function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/mapbox/${name}.json`, import.meta.url), "utf8"),
  );
}

const OG = "https://og.example.com";
const VENDOR = "https://api.mapbox.com";

const toVendor = (fetch: Fetch, plugins?: Plugin[]): MapboxClient =>
  mapbox({ accessToken: "pk.tok", fetch, logLevel: "off", plugins });

/** An og client that is also given a token, to show the token stays home. */
const toOg = (fetch: Fetch, plugins?: Plugin[]): MapboxClient =>
  mapbox({ baseUrl: `${OG}/`, accessToken: "pk.tok", fetch, logLevel: "off", plugins });

/** The query of the nth request, as a plain object. */
const queryOf = (fetch: Fetch, call = 0): Record<string, string> =>
  Object.fromEntries(urlOf(fetch, call).searchParams);

const methodOf = (fetch: Fetch, call = 0): string | undefined => fetch.mock.calls[call]![1]?.method;

interface Case {
  /** The dotted name of the method on the client. */
  name: string;
  fixture: string;
  call: (client: MapboxClient) => APIPromise<unknown>;
  method: "GET" | "POST";
  path: string;
  /** The query Mapbox is sent, without the access token. */
  query: Record<string, string>;
  body?: unknown;
  /** The points a plugin reads out of the fixture. */
  positions: Position[];
}

const CASES: Case[] = [
  {
    name: "geocoding.forward",
    fixture: "geocoding-forward",
    call: (client) =>
      client.geocoding.forward({
        q: "1846 Thornfield Road",
        autocomplete: false,
        bbox: [-111, 46, -110, 47],
        country: ["us", "ca"],
        format: "geojson",
        language: ["en", "es"],
        limit: 2,
        proximity: [-110.4, 46.6],
        types: ["address", "street"],
        worldview: "us",
        entrances: true,
      }),
    method: "GET",
    path: "/search/geocode/v6/forward",
    query: {
      q: "1846 Thornfield Road",
      autocomplete: "false",
      bbox: "-111,46,-110,47",
      country: "us,ca",
      format: "geojson",
      language: "en,es",
      limit: "2",
      proximity: "-110.4,46.6",
      types: "address,street",
      worldview: "us",
      entrances: "true",
    },
    positions: [
      { lat: 46.587319, lon: -110.412736 },
      { lat: 46.590144, lon: -110.468205 },
    ],
  },
  {
    name: "geocoding.reverse",
    fixture: "geocoding-forward",
    call: (client) =>
      client.geocoding.reverse({
        longitude: -110.412736,
        latitude: 46.587319,
        country: "us",
        language: "en",
        limit: 3,
        types: "address",
        worldview: "us",
      }),
    method: "GET",
    path: "/search/geocode/v6/reverse",
    query: {
      longitude: "-110.412736",
      latitude: "46.587319",
      country: "us",
      language: "en",
      limit: "3",
      types: "address",
      worldview: "us",
    },
    positions: [
      { lat: 46.587319, lon: -110.412736 },
      { lat: 46.590144, lon: -110.468205 },
    ],
  },
  {
    name: "geocoding.batch",
    fixture: "geocoding-batch",
    call: (client) =>
      client.geocoding.batch({
        queries: [
          { q: "305 Heronsgate Avenue East", types: ["address"], bbox: [-80, 40, -70, 50] },
          { address_number: "12", street: "Nowhere Lane", place: "Atlantis", country: "ca" },
          { longitude: -72.6418273, latitude: 44.3127465, types: "address" },
        ],
      }),
    method: "POST",
    path: "/search/geocode/v6/batch",
    query: {},
    body: [
      { q: "305 Heronsgate Avenue East", types: ["address"], bbox: [-80, 40, -70, 50] },
      { address_number: "12", street: "Nowhere Lane", place: "Atlantis", country: "ca" },
      { longitude: -72.6418273, latitude: 44.3127465, types: "address" },
    ],
    // The second query found nothing, so it has no point.
    positions: [
      { lat: 44.61853, lon: -78.31427 },
      { lat: 44.3127465, lon: -72.6418273 },
    ],
  },
  {
    name: "searchbox.suggest",
    fixture: "searchbox-suggest",
    call: (client) =>
      client.searchbox.suggest({
        q: "calloway lan",
        session_token: "0b7c1f6e-session",
        language: "en",
        limit: 4,
        proximity: "ip",
        near: "Dunster Falls",
        bbox: "-90,43,-89,44",
        country: ["us"],
        types: ["poi", "address"],
        poi_category: ["museum", "gallery"],
        poi_category_exclusions: "bar",
        show_closed_pois: true,
        radius: 0.5,
        sar_type: "isochrone",
        route: "abc~123",
        route_geometry: "polyline6",
        time_deviation: 5,
        eta_type: "navigation",
        navigation_profile: "walking",
        origin: [-89.6, 43.4],
      }),
    method: "GET",
    path: "/search/searchbox/v1/suggest",
    query: {
      q: "calloway lan",
      session_token: "0b7c1f6e-session",
      language: "en",
      limit: "4",
      proximity: "ip",
      near: "Dunster Falls",
      bbox: "-90,43,-89,44",
      country: "us",
      types: "poi,address",
      poi_category: "museum,gallery",
      poi_category_exclusions: "bar",
      show_closed_pois: "true",
      radius: "0.5",
      sar_type: "isochrone",
      route: "abc~123",
      route_geometry: "polyline6",
      time_deviation: "5",
      eta_type: "navigation",
      navigation_profile: "walking",
      origin: "-89.6,43.4",
    },
    positions: [],
  },
  {
    name: "searchbox.retrieve",
    fixture: "searchbox-retrieve",
    call: (client) =>
      client.searchbox.retrieve({
        id: "dXJuOm1ieHBvaTo2YTQw/needs encoding",
        session_token: "0b7c1f6e-session",
        language: "en",
        attribute_sets: ["visit", "venue"],
        proximity: [-89.6, 43.4],
        eta_type: "navigation",
        navigation_profile: "driving",
        origin: "-89.7,43.5",
      }),
    method: "GET",
    path: "/search/searchbox/v1/retrieve/dXJuOm1ieHBvaTo2YTQw%2Fneeds%20encoding",
    query: {
      session_token: "0b7c1f6e-session",
      language: "en",
      attribute_sets: "visit,venue",
      proximity: "-89.6,43.4",
      eta_type: "navigation",
      navigation_profile: "driving",
      origin: "-89.7,43.5",
    },
    positions: [{ lat: 43.41856203917482, lon: -89.63127485206913 }],
  },
  {
    name: "searchbox.forward",
    fixture: "searchbox-forward",
    call: (client) =>
      client.searchbox.forward({
        q: "tea house",
        limit: 1,
        open_now: true,
        minimum_rating: 4.5,
        price_levels: ["$", "$$"],
        exclude_fields: ["photos", "reviews"],
        rank_strategy: "distance",
        auto_complete: true,
      }),
    method: "GET",
    path: "/search/searchbox/v1/forward",
    query: {
      q: "tea house",
      limit: "1",
      open_now: "true",
      minimum_rating: "4.5",
      price_levels: "$,$$",
      exclude_fields: "photos,reviews",
      rank_strategy: "distance",
      auto_complete: "true",
    },
    positions: [{ lat: 39.612905, lon: -105.137482 }],
  },
  {
    name: "searchbox.reverse",
    fixture: "searchbox-forward",
    call: (client) =>
      client.searchbox.reverse({
        longitude: -105.137482,
        latitude: 39.612905,
        language: "de",
        limit: 2,
        country: "us",
        types: ["address", "poi"],
        show_closed_pois: false,
      }),
    method: "GET",
    path: "/search/searchbox/v1/reverse",
    query: {
      longitude: "-105.137482",
      latitude: "39.612905",
      language: "de",
      limit: "2",
      country: "us",
      types: "address,poi",
      show_closed_pois: "false",
    },
    positions: [{ lat: 39.612905, lon: -105.137482 }],
  },
  {
    name: "searchbox.category",
    fixture: "searchbox-category",
    call: (client) =>
      client.searchbox.category({
        canonical_category_id: "tea_house",
        limit: 25,
        proximity: [-123.2, 44.05],
        exclude_fields: "photos",
      }),
    method: "GET",
    path: "/search/searchbox/v1/category/tea_house",
    query: { limit: "25", proximity: "-123.2,44.05", exclude_fields: "photos" },
    positions: [{ lat: 44.0518327, lon: -123.2071468 }],
  },
  {
    name: "searchbox.listCategories",
    fixture: "searchbox-list-category",
    call: (client) => client.searchbox.listCategories({ language: "fr" }),
    method: "GET",
    path: "/search/searchbox/v1/list/category",
    query: { language: "fr" },
    positions: [],
  },
];

describe("mapbox", () => {
  it("needs an og server or an access token", () => {
    let thrown: unknown;
    try {
      mapbox({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeocoderError);
    expect(thrown).toMatchObject({ code: "invalid_request", provider: "mapbox" });
  });

  it("says which API it speaks and which server answers", () => {
    const fetch = fakeFetch({});
    expect(toVendor(fetch)).toMatchObject({ shape: "mapbox", server: "mapbox" });
    expect(toOg(fetch)).toMatchObject({ shape: "mapbox", server: "og" });
  });

  it("has a case for every method of the client", () => {
    const client = toVendor(fakeFetch({}));
    const names = [
      ...Object.keys(client.geocoding).map((name) => `geocoding.${name}`),
      ...Object.keys(client.searchbox).map((name) => `searchbox.${name}`),
    ];
    expect(new Set(CASES.map((each) => each.name))).toEqual(new Set(names));
    expect(CASES).toHaveLength(names.length);
  });

  it("types each answer as Mapbox's own", () => {
    const client = toVendor(fakeFetch({}));
    expectTypeOf(client.geocoding.forward).returns.resolves.toEqualTypeOf<GeocodingResponse>();
    expectTypeOf(client.geocoding.reverse).returns.resolves.toEqualTypeOf<GeocodingResponse>();
    expectTypeOf(client.geocoding.batch).returns.resolves.toEqualTypeOf<GeocodingBatchResponse>();
    expectTypeOf(
      client.searchbox.suggest,
    ).returns.resolves.toEqualTypeOf<SearchBoxSuggestResponse>();
    expectTypeOf(client.searchbox.retrieve).returns.resolves.toEqualTypeOf<SearchBoxResponse>();
    expectTypeOf(client.searchbox.forward).returns.resolves.toEqualTypeOf<SearchBoxResponse>();
    expectTypeOf(client.searchbox.reverse).returns.resolves.toEqualTypeOf<SearchBoxResponse>();
    expectTypeOf(client.searchbox.category).returns.resolves.toEqualTypeOf<SearchBoxResponse>();
    expectTypeOf(
      client.searchbox.listCategories,
    ).returns.resolves.toEqualTypeOf<SearchBoxListCategoriesResponse>();
  });

  describe.each(CASES)("$name", (each) => {
    const answer = fixture(each.fixture);

    it("asks Mapbox itself, with the access token in the query", async () => {
      const fetch = fakeFetch({ body: answer });
      const data = await each.call(toVendor(fetch));
      const url = urlOf(fetch);
      expect(url.origin).toBe(VENDOR);
      expect(url.pathname).toBe(each.path);
      expect(queryOf(fetch)).toEqual({ ...each.query, access_token: "pk.tok" });
      expect(methodOf(fetch)).toBe(each.method);
      expect(headersOf(fetch)["accept"]).toBe("application/json");
      expect(headersOf(fetch)["authorization"]).toBeUndefined();
      if (each.body === undefined) {
        expect(fetch.mock.calls[0]![1]?.body).toBeUndefined();
      } else {
        expect(bodyOf(fetch)).toEqual(each.body);
        expect(headersOf(fetch)["content-type"]).toBe("application/json");
      }
      expect(data).toEqual(answer);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("asks og under /compat/mapbox, without the access token", async () => {
      const fetch = fakeFetch({ body: answer });
      const data = await each.call(toOg(fetch));
      const url = urlOf(fetch);
      expect(url.origin).toBe(OG);
      expect(url.pathname).toBe(`/compat/mapbox${each.path}`);
      expect(queryOf(fetch)).toEqual(each.query);
      expect(methodOf(fetch)).toBe(each.method);
      if (each.body !== undefined) expect(bodyOf(fetch)).toEqual(each.body);
      expect(String(fetch.mock.calls[0]![0])).not.toContain("pk.tok");
      expect(JSON.stringify(headersOf(fetch))).not.toContain("pk.tok");
      expect(data).toEqual(answer);
    });

    it("keeps none of Mapbox's answer, and any of og's", async () => {
      const vendor = await each.call(toVendor(fakeFetch({ body: answer }))).withResponse();
      expect(vendor.server).toBe("mapbox");
      expect(vendor.cache).toEqual({ maxTtl: 0 });
      expect(vendor.response?.status).toBe(200);
      const og = await each.call(toOg(fakeFetch({ body: answer }))).withResponse();
      expect(og.server).toBe("og");
      expect(og.cache).toEqual({ maxTtl: Infinity });
    });

    it("gives a plugin the method, the arguments and the points", async () => {
      const seen: { method: string; args: readonly unknown[]; points: Position[] }[] = [];
      const spy: Plugin = {
        name: "spy",
        async handle(call, next) {
          const outcome = await next();
          seen.push({
            method: call.method,
            args: call.args,
            points: call.positions(outcome.data),
          });
          return outcome;
        },
      };
      await each.call(toVendor(fakeFetch({ body: answer }), [spy]));
      expect(seen).toHaveLength(1);
      expect(seen[0]!.method).toBe(each.name);
      expect(seen[0]!.args).toHaveLength(1);
      expect(seen[0]!.points).toEqual(each.positions);
    });

    it("runs again on another client by its name", async () => {
      const first = fakeFetch({ body: {} });
      const second = fakeFetch({ body: answer });
      const other = toOg(second);
      const reroute: Plugin = { name: "reroute", handle: (call) => call.run(other) };
      const outcome = await each.call(toVendor(first, [reroute])).withResponse();
      expect(first).not.toHaveBeenCalled();
      expect(urlOf(second).pathname).toBe(`/compat/mapbox${each.path}`);
      expect(queryOf(second)).toEqual(each.query);
      expect(outcome.server).toBe("og");
      expect(outcome.data).toEqual(answer);
    });
  });

  describe("requests", () => {
    it("sends structured input without a q", async () => {
      const fetch = fakeFetch({ body: fixture("geocoding-match-code") });
      await toVendor(fetch).geocoding.forward({
        address_line1: "2595 Kestrel Hollow Drive",
        address_number: "2595",
        street: "Kestrel Hollow Drive",
        block: "3",
        place: "Marlow Ridge",
        region: "CO",
        postcode: "84060",
        locality: "Old Town",
        neighborhood: "Pinebrook",
        country: "us",
        autocomplete: false,
        language: undefined,
      });
      expect(queryOf(fetch)).toEqual({
        address_line1: "2595 Kestrel Hollow Drive",
        address_number: "2595",
        street: "Kestrel Hollow Drive",
        block: "3",
        place: "Marlow Ridge",
        region: "CO",
        postcode: "84060",
        locality: "Old Town",
        neighborhood: "Pinebrook",
        country: "us",
        autocomplete: "false",
        access_token: "pk.tok",
      });
    });

    it("lists the categories with nothing to pass", async () => {
      const fetch = fakeFetch({ body: fixture("searchbox-list-category") });
      await toVendor(fetch).searchbox.listCategories();
      expect(urlOf(fetch).pathname).toBe("/search/searchbox/v1/list/category");
      expect(queryOf(fetch)).toEqual({ access_token: "pk.tok" });
    });

    it("sends the headers of the client and of the call", async () => {
      const fetch = fakeFetch({ body: fixture("geocoding-forward") });
      const client = mapbox({
        baseUrl: OG,
        fetch,
        logLevel: "off",
        headers: { "x-gateway": "a" },
      });
      await client.geocoding.forward({ q: "x" }, { headers: { "x-trace": "b" } });
      expect(headersOf(fetch)).toMatchObject({ "x-gateway": "a", "x-trace": "b" });
    });

    it("returns keys the types do not list untouched", async () => {
      const answer = { type: "FeatureCollection", features: [], attribution: "a", extra: { n: 1 } };
      const fetch = fakeFetch({ body: answer });
      expect(await toVendor(fetch).geocoding.forward({ q: "x" })).toEqual(answer);
    });
  });

  describe("cache rule", () => {
    const stored = { permanent: true } as const;

    it("keeps a Geocoding answer asked for as permanent without limit", async () => {
      const fetch = fakeFetch({ body: fixture("geocoding-forward") });
      const client = toVendor(fetch);
      const forward = await client.geocoding.forward({ q: "x", ...stored }).withResponse();
      expect(queryOf(fetch, 0)).toMatchObject({ permanent: "true" });
      expect(forward.cache).toEqual({ maxTtl: Infinity });
      const reverse = await client.geocoding
        .reverse({ longitude: 1, latitude: 2, ...stored })
        .withResponse();
      expect(queryOf(fetch, 1)).toMatchObject({ permanent: "true" });
      expect(reverse.cache).toEqual({ maxTtl: Infinity });
    });

    it("sends a batch's permanent in the query, never in the body", async () => {
      const fetch = fakeFetch({ body: fixture("geocoding-batch") });
      const outcome = await toVendor(fetch)
        .geocoding.batch({ queries: [{ q: "x" }], ...stored })
        .withResponse();
      expect(queryOf(fetch)).toEqual({ permanent: "true", access_token: "pk.tok" });
      expect(bodyOf(fetch)).toEqual([{ q: "x" }]);
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
    });

    it("keeps none of an answer asked for with permanent false", async () => {
      const fetch = fakeFetch({ body: fixture("geocoding-forward") });
      const outcome = await toVendor(fetch)
        .geocoding.forward({ q: "x", permanent: false })
        .withResponse();
      expect(queryOf(fetch)).toMatchObject({ permanent: "false" });
      expect(outcome.cache).toEqual({ maxTtl: 0 });
    });
  });

  describe("retries", () => {
    const busy = { status: 503, body: { message: "busy" }, headers: { "retry-after-ms": "1" } };

    it("does not retry a suggestion", async () => {
      const fetch = fakeFetch(busy, { body: fixture("searchbox-suggest") });
      const failed = await toVendor(fetch)
        .searchbox.suggest({ q: "cal", session_token: "s" })
        .catch((error: unknown) => error);
      expect(failed).toMatchObject({ code: "unavailable", status: 503 });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("retries a suggestion when the call asks for it", async () => {
      const answer = fixture("searchbox-suggest");
      const fetch = fakeFetch(busy, { body: answer });
      const data = await toVendor(fetch).searchbox.suggest(
        { q: "cal", session_token: "s" },
        { maxRetries: 1 },
      );
      expect(data).toEqual(answer);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("retries a lookup and a batch, since both only read", async () => {
      const forward = fakeFetch(busy, { body: fixture("geocoding-forward") });
      await toVendor(forward).geocoding.forward({ q: "x" });
      expect(forward).toHaveBeenCalledTimes(2);
      const batch = fakeFetch(busy, { body: fixture("geocoding-batch") });
      await toVendor(batch).geocoding.batch({ queries: [{ q: "x" }] });
      expect(batch).toHaveBeenCalledTimes(2);
    });
  });

  describe("errors", () => {
    it("wraps Mapbox's error, with its message, status, body and request ID", async () => {
      const fetch = fakeFetch({
        status: 401,
        body: fixture("error"),
        headers: { "x-request-id": "req-41" },
      });
      const failed = (await toVendor(fetch)
        .geocoding.forward({ q: "x" })
        .catch((error: unknown) => error)) as GeocoderError;
      expect(failed).toBeInstanceOf(GeocoderError);
      expect(failed.message).toBe("The access token on this request is not valid");
      expect(failed).toMatchObject({
        code: "unauthenticated",
        status: 401,
        provider: "mapbox",
        operation: "geocoding.forward",
        requestId: "req-41",
        body: fixture("error"),
      });
      expect(failed.cause).toBeInstanceOf(AuthenticationError);
      expect(failed.cause).toMatchObject({ status: 401, body: fixture("error") });
      expect((failed.cause as AuthenticationError).headers?.get("x-request-id")).toBe("req-41");
    });

    it("names og as the provider when og answered", async () => {
      const fetch = fakeFetch({ status: 400, body: { message: "q is required" } });
      const failed = await toOg(fetch)
        .searchbox.forward({ q: "" })
        .catch((error: unknown) => error);
      expect(failed).toMatchObject({
        code: "invalid_request",
        status: 400,
        provider: "og",
        operation: "searchbox.forward",
        message: "q is required",
      });
    });

    it("reads a 501 as unsupported", async () => {
      const fetch = fakeFetch({ status: 501, body: { message: "Not Implemented" } });
      const failed = await toOg(fetch)
        .searchbox.category({ canonical_category_id: "coffee" }, { maxRetries: 0 })
        .catch((error: unknown) => error);
      expect(failed).toMatchObject({ code: "unsupported", status: 501, provider: "og" });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("reads a batch that is too long as too large, not as malformed", async () => {
      const body = { message: "Batch queries must include 50 queries or less" };
      const fetch = fakeFetch({ status: 422, body });
      const failed = (await toVendor(fetch)
        .geocoding.batch({ queries: [{ q: "x" }] })
        .catch((error: unknown) => error)) as GeocoderError;
      expect(failed).toMatchObject({ code: "payload_too_large", status: 422, body });
      expect(failed.cause).toBeInstanceOf(UnprocessableEntityError);
    });

    it("reads any other 422 as an invalid request", async () => {
      const body = { message: "limit must be combined with a single type parameter" };
      const failed = await toVendor(fakeFetch({ status: 422, body }))
        .geocoding.reverse({ longitude: 1, latitude: 2, limit: 3 })
        .catch((error: unknown) => error);
      expect(failed).toMatchObject({ code: "invalid_request", status: 422 });
      const batch = await toVendor(fakeFetch({ status: 422, body }))
        .geocoding.batch({ queries: [{ longitude: 1, latitude: 2, limit: 3 }] })
        .catch((error: unknown) => error);
      expect(batch).toMatchObject({ code: "invalid_request", status: 422 });
    });

    it("reads a rate limit, and a body that is not JSON", async () => {
      const limited = await toVendor(
        fakeFetch({ status: 429, body: { message: "Rate limit exceeded" } }),
      )
        .searchbox.suggest({ q: "x", session_token: "s" })
        .catch((error: unknown) => error);
      expect(limited).toMatchObject({ code: "rate_limited", message: "Rate limit exceeded" });
      const broken = await toVendor(fakeFetch({ body: "<html>" }))
        .searchbox.reverse({ longitude: 1, latitude: 2 })
        .catch((error: unknown) => error);
      expect(broken).toMatchObject({ code: "provider_error", status: 200, provider: "mapbox" });
    });
  });

  describe("positions", () => {
    it("leaves out a result without a point, and falls back to the properties", async () => {
      const seen: Position[][] = [];
      const spy: Plugin = {
        name: "spy",
        async handle(call, next) {
          const outcome = await next();
          seen.push(call.positions(outcome.data));
          return outcome;
        },
      };
      const body = {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { coordinates: { longitude: 7.5, latitude: 43.5 } } },
          { type: "Feature", properties: {} },
          { type: "Feature", geometry: { type: "Point", coordinates: [7.25, 43.75] } },
        ],
      };
      await toVendor(fakeFetch({ body }), [spy]).searchbox.forward({ q: "x" });
      expect(seen).toEqual([
        [
          { lat: 43.5, lon: 7.5 },
          { lat: 43.75, lon: 7.25 },
        ],
      ]);
    });
  });
});
