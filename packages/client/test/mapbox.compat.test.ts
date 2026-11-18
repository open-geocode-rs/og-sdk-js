/// <reference types="node" />
import { describe, expect, it } from "vitest";
import type { Plugin, Position } from "../src/base.ts";
import { GeocoderError, NotFoundError } from "../src/errors.ts";
import { mapbox } from "../src/mapbox.ts";

const OG_URL = process.env["OG_URL"];

/** The address the Monaco test Pack is asked for, and the point it lies at. */
const ADDRESS = "2 Avenue de Monte-Carlo";
const POINT = { longitude: 7.4270688, latitude: 43.7377547 };

// These run against a real og server, which answers Mapbox's API under /compat/mapbox.
describe.runIf(OG_URL)("mapbox against og", () => {
  // A token is given to show that og is asked without it and answers all the same.
  const client = mapbox({ baseUrl: OG_URL, accessToken: "pk.never-sent", logLevel: "off" });

  it("points at og", () => {
    expect(client).toMatchObject({ shape: "mapbox", server: "og" });
  });

  describe("geocoding", () => {
    it("finds an address by search text", async () => {
      const outcome = await client.geocoding.forward({ q: ADDRESS, limit: 1 }).withResponse();
      expect(outcome.server).toBe("og");
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
      expect(outcome.requestId).toEqual(expect.any(String));
      expect(outcome.response?.url).toContain("/compat/mapbox/search/geocode/v6/forward?");
      expect(outcome.response?.url).not.toContain("access_token");

      const { data } = outcome;
      expect(data.type).toBe("FeatureCollection");
      expect(data.attribution).toEqual(expect.any(String));
      expect(data.features).toHaveLength(1);
      const feature = data.features[0]!;
      expect(feature.type).toBe("Feature");
      expect(feature.id).toBe(feature.properties.mapbox_id);
      expect(feature.geometry).toEqual({
        type: "Point",
        coordinates: [POINT.longitude, POINT.latitude],
      });
      expect(feature.properties).toMatchObject({
        feature_type: "address",
        name: ADDRESS,
        coordinates: { ...POINT, accuracy: "rooftop" },
      });
      expect(feature.properties.full_address).toContain(ADDRESS);
      expect(feature.properties.context).toMatchObject({
        address: { address_number: "2", street_name: "Avenue de Monte-Carlo", name: ADDRESS },
        street: { name: "Avenue de Monte-Carlo" },
        place: { name: "Monaco" },
        country: { name: "Monaco", country_code: "MC", country_code_alpha_3: "MCO" },
      });
    });

    it("finds an address given part by part", async () => {
      const data = await client.geocoding.forward({
        address_number: "2",
        street: "Avenue de Monte-Carlo",
        place: "Monaco",
        country: "mc",
        autocomplete: false,
        limit: 1,
      });
      expect(data.features[0]?.properties).toMatchObject({
        feature_type: "address",
        name: ADDRESS,
      });
      expect(data.features[0]?.geometry.coordinates).toEqual([POINT.longitude, POINT.latitude]);
    });

    it("honours types, limit and several languages", async () => {
      const data = await client.geocoding.forward({
        q: "Monte-Carlo",
        types: ["neighborhood"],
        language: ["fr", "en"],
        limit: 1,
      });
      expect(data.features).toHaveLength(1);
      const { properties } = data.features[0]!;
      expect(properties.feature_type).toBe("neighborhood");
      expect(properties.name).toBe("Monte-Carlo");
      expect(properties.context.neighborhood?.translations).toMatchObject({
        fr: { language: "fr", name: "Monte-Carlo" },
        en: { language: "en", name: "Monte-Carlo" },
      });
    });

    it("answers a feature by the ID of an earlier answer", async () => {
      const first = await client.geocoding.forward({ q: ADDRESS, limit: 1 });
      const id = first.features[0]!.properties.mapbox_id;
      const again = await client.geocoding.forward({ q: id });
      expect(again.features).toHaveLength(1);
      expect(again.features[0]!.id).toBe(id);
      expect(again.features[0]!.geometry.coordinates).toEqual([POINT.longitude, POINT.latitude]);
    });

    it("finds what is at a point, the most specific first", async () => {
      const data = await client.geocoding.reverse(POINT);
      expect(data.type).toBe("FeatureCollection");
      expect(data.features.length).toBeGreaterThan(1);
      expect(data.features[0]!.properties).toMatchObject({
        feature_type: "address",
        name: ADDRESS,
      });
      const types = data.features.map((feature) => feature.properties.feature_type);
      expect(types).toContain("neighborhood");
      expect(new Set(types).size).toBe(types.length);

      const one = await client.geocoding.reverse({ ...POINT, types: "address", limit: 2 });
      expect(one.features.length).toBeGreaterThanOrEqual(1);
      expect(one.features.every((feature) => feature.properties.feature_type === "address")).toBe(
        true,
      );
    });

    it("refuses a reverse limit without a single type, as Mapbox does", async () => {
      const failed = (await client.geocoding
        .reverse({ ...POINT, limit: 3 })
        .catch((error: unknown) => error)) as GeocoderError;
      expect(failed).toBeInstanceOf(GeocoderError);
      expect(failed).toMatchObject({
        code: "invalid_request",
        status: 422,
        provider: "og",
        operation: "geocoding.reverse",
        message: "limit must be combined with a single type parameter when reverse geocoding",
      });
      expect(failed.requestId).toEqual(expect.any(String));
    });

    it("runs a batch of forward, structured and reverse queries in order", async () => {
      const outcome = await client.geocoding
        .batch({
          permanent: true,
          queries: [
            { q: ADDRESS, types: ["address"], limit: 1 },
            { q: "zzzzqqqq xxyyzz" },
            { ...POINT, types: "address" },
            { address_line1: ADDRESS, place: "Monaco", country: "mc", limit: 1 },
          ],
        })
        .withResponse();
      expect(outcome.response?.url).toContain("/compat/mapbox/search/geocode/v6/batch");
      expect(outcome.cache).toEqual({ maxTtl: Infinity });
      const { batch } = outcome.data;
      expect(batch).toHaveLength(4);
      for (const answer of batch) {
        expect(answer.type).toBe("FeatureCollection");
        expect(answer.attribution).toEqual(expect.any(String));
      }
      expect(batch[1]!.features).toEqual([]);
      for (const index of [0, 2, 3]) {
        const feature = batch[index]!.features[0]!;
        expect(feature.properties).toMatchObject({ feature_type: "address", name: ADDRESS });
        expect(feature.geometry.coordinates).toEqual([POINT.longitude, POINT.latitude]);
      }
    });
  });

  describe("searchbox", () => {
    it("suggests, then retrieves the suggestion picked", async () => {
      const session_token = crypto.randomUUID();
      const suggested = await client.searchbox
        .suggest({ q: "casino", session_token, limit: 5 })
        .withResponse();
      expect(suggested.response?.url).toContain("/compat/mapbox/search/searchbox/v1/suggest?");
      expect(suggested.data.attribution).toEqual(expect.any(String));
      const { suggestions } = suggested.data;
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.length).toBeLessThanOrEqual(5);
      for (const suggestion of suggestions) {
        expect(suggestion.name.toLowerCase()).toContain("casino");
        expect(suggestion.mapbox_id).toEqual(expect.any(String));
        expect(suggestion.feature_type).toEqual(expect.any(String));
        expect(suggestion).not.toHaveProperty("coordinates");
      }

      const picked = suggestions[0]!;
      const retrieved = await client.searchbox
        .retrieve({ id: picked.mapbox_id, session_token })
        .withResponse();
      expect(retrieved.response?.url).toContain(
        `/compat/mapbox/search/searchbox/v1/retrieve/${picked.mapbox_id}?`,
      );
      expect(retrieved.data.type).toBe("FeatureCollection");
      expect(retrieved.data.features).toHaveLength(1);
      const feature = retrieved.data.features[0]!;
      expect(feature.properties).toMatchObject({
        mapbox_id: picked.mapbox_id,
        name: picked.name,
        feature_type: picked.feature_type,
      });
      const [longitude, latitude] = feature.geometry.coordinates;
      expect(feature.geometry.type).toBe("Point");
      expect(feature.properties.coordinates).toMatchObject({ longitude, latitude });
      // Monaco is small enough that any of its places lies within this box.
      expect(longitude).toBeGreaterThan(7.3);
      expect(longitude).toBeLessThan(7.5);
      expect(latitude).toBeGreaterThan(43.7);
      expect(latitude).toBeLessThan(43.8);
    });

    it("limits suggestions to the types asked for", async () => {
      const { suggestions } = await client.searchbox.suggest({
        q: "casino",
        session_token: crypto.randomUUID(),
        types: "poi",
      });
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.every((suggestion) => suggestion.feature_type === "poi")).toBe(true);
    });

    it("answers 404 for an ID it does not know", async () => {
      const failed = (await client.searchbox
        .retrieve({ id: "bm9wZQ", session_token: "s" })
        .catch((error: unknown) => error)) as GeocoderError;
      expect(failed).toMatchObject({
        code: "not_found",
        status: 404,
        provider: "og",
        operation: "searchbox.retrieve",
        body: { message: "Not Found" },
      });
      expect(failed.cause).toBeInstanceOf(NotFoundError);
    });

    it("searches places and POIs in one request", async () => {
      const address = await client.searchbox.forward({ q: ADDRESS, limit: 1 });
      expect(address.type).toBe("FeatureCollection");
      expect(address.features).toHaveLength(1);
      expect(address.features[0]!.geometry).toEqual({
        type: "Point",
        coordinates: [POINT.longitude, POINT.latitude],
      });
      expect(address.features[0]!.properties).toMatchObject({
        name: ADDRESS,
        feature_type: "address",
        address: ADDRESS,
        coordinates: { ...POINT, accuracy: "rooftop" },
        context: {
          address: { address_number: "2", street_name: "Avenue de Monte-Carlo" },
          place: { name: "Monaco" },
          country: { country_code: "MC", country_code_alpha_3: "MCO" },
        },
      });

      const pois = await client.searchbox.forward({ q: "casino", types: ["poi"], limit: 3 });
      expect(pois.features.length).toBeGreaterThan(0);
      expect(pois.features.length).toBeLessThanOrEqual(3);
      for (const feature of pois.features) {
        expect(feature.properties.feature_type).toBe("poi");
        expect(feature.properties.name.toLowerCase()).toContain("casino");
      }
    });

    it("finds what is at a point", async () => {
      const data = await client.searchbox.reverse({ ...POINT, limit: 1 });
      expect(data.features.length).toBeGreaterThanOrEqual(1);
      const feature = data.features[0]!;
      expect(feature.geometry.coordinates).toEqual([POINT.longitude, POINT.latitude]);
      expect(feature.properties).toMatchObject({
        name: ADDRESS,
        feature_type: "address",
        coordinates: POINT,
      });
      expect(feature.properties.context.address?.id).toBe(feature.properties.mapbox_id);
    });

    it("has no category search on og, which answers 501", async () => {
      const category = (await client.searchbox
        .category({ canonical_category_id: "coffee" })
        .catch((error: unknown) => error)) as GeocoderError;
      expect(category).toBeInstanceOf(GeocoderError);
      expect(category).toMatchObject({
        code: "unsupported",
        status: 501,
        provider: "og",
        operation: "searchbox.category",
      });
      const list = await client.searchbox.listCategories().catch((error: unknown) => error);
      expect(list).toMatchObject({
        code: "unsupported",
        status: 501,
        operation: "searchbox.listCategories",
      });
    });
  });

  it("gives a plugin the points of real answers", async () => {
    const seen: Record<string, Position[]> = {};
    const spy: Plugin = {
      name: "spy",
      async handle(call, next) {
        const outcome = await next();
        seen[call.method] = call.positions(outcome.data);
        return outcome;
      },
    };
    const watched = mapbox({ baseUrl: OG_URL, logLevel: "off", plugins: [spy] });
    const here = { lat: POINT.latitude, lon: POINT.longitude };
    await watched.geocoding.forward({ q: ADDRESS, limit: 1 });
    await watched.searchbox.reverse({ ...POINT, types: "address" });
    await watched.geocoding.batch({
      queries: [{ q: ADDRESS, limit: 2 }, { q: "zzzzqqqq" }, POINT],
    });
    await watched.searchbox.suggest({ q: "casino", session_token: "s" });
    expect(seen["geocoding.forward"]).toEqual([here]);
    expect(seen["searchbox.reverse"]?.[0]).toEqual(here);
    expect(seen["geocoding.batch"]).toEqual([here, here]);
    expect(seen["searchbox.suggest"]).toEqual([]);
  });
});
