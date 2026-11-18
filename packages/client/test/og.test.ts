/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { Geocoder, type GeocoderError } from "../src/index.ts";
import { og } from "../src/og.ts";
import { cache, compare, type CompareReport, failover } from "../src/plugins/index.ts";
import forwardFixture from "./fixtures/og/geocode.json" with { type: "json" };
import placesFixture from "./fixtures/og/places.json" with { type: "json" };
import { fakeFetch, urlOf } from "./helpers.ts";

const geocoder = (fetch: typeof globalThis.fetch) =>
  new Geocoder({ adapter: og({ baseUrl: "http://og.test/", fetch, logLevel: "off" }) });

describe("the og adapter", () => {
  it("maps a forward result to the unified format", async () => {
    const fetch = fakeFetch({ body: forwardFixture, headers: { "x-request-id": "req-1" } });
    const answer = await geocoder(fetch)
      .geocode("10 King St W Apt 4, Toronto", {
        limit: 2,
        language: ["en", "fr"],
        countries: ["ca"],
        focus: { lat: 43.65, lon: -79.38 },
        bounds: [-80, 43, -79, 44],
        include: ["context", "addressDetails", "streetParts", "translations", "bbox"],
      })
      .withResponse();
    expect(urlOf(fetch).href).toBe(
      "http://og.test/geocode?limit=2&lang=en%2Cfr&country=CA&focus=-79.38%2C43.65&bbox=-80%2C43%2C-79%2C44&q=10+King+St+W+Apt+4%2C+Toronto",
    );
    expect(answer.requestId).toBe("req-1");
    expect(answer.data).toEqual({
      provider: "og",
      operation: "geocode",
      results: [
        {
          id: "openaddresses:ca/on/city_of_toronto:1f",
          type: "address",
          name: "10 King Street West",
          label: "10 King Street West, Toronto, ON",
          location: { lat: 43.6491, lon: -79.3783 },
          accuracy: "rooftop",
          confidence: 0.93,
          distance: 170.4,
          address: {
            houseNumber: "10",
            street: "King Street West",
            unit: "Apt 4",
            neighbourhood: "Financial District",
            locality: "Toronto",
            district: "Golden Horseshoe",
            region: "Ontario",
            regionCode: "ON",
            postcode: "M5H 1A1",
            country: "Canada",
            countryCode: "CA",
          },
          context: {
            neighbourhood: {
              name: "Financial District",
              id: "osm:relation:1",
              code: null,
              wikidata: null,
              translations: null,
            },
            sublocality: {
              name: "Old Toronto",
              id: "osm:relation:2",
              code: null,
              wikidata: null,
              translations: null,
            },
            locality: {
              name: "Toronto",
              id: "osm:relation:324211",
              code: null,
              wikidata: null,
              translations: null,
            },
            district: {
              name: "Golden Horseshoe",
              id: "osm:relation:3",
              code: null,
              wikidata: null,
              translations: null,
            },
            region: {
              name: "Ontario",
              id: "osm:relation:68841",
              code: "CA-ON",
              wikidata: null,
              translations: null,
            },
            country: {
              name: "Canada",
              id: "osm:relation:1428125",
              code: "CA",
              wikidata: null,
              translations: { fr: "Canada" },
            },
          },
          addressDetails: {
            unitType: "Apt",
            building: null,
            floor: null,
            sublocality: "Old Toronto",
            postcodeSuffix: null,
          },
          streetParts: { prefix: null, name: "King", type: "Street", suffix: "West" },
          translations: null,
          bbox: null,
        },
        {
          id: "osm:relation:324211",
          type: "locality",
          name: "Toronto",
          label: "Toronto, ON, Canada",
          location: { lat: 43.6535, lon: -79.3839 },
          accuracy: "centroid",
          confidence: null,
          // og sent no distance for this one, so it is measured from the focus.
          distance: 499.92,
          address: {
            houseNumber: null,
            street: null,
            unit: null,
            neighbourhood: null,
            // An area is not in its own context, so it names its own tier.
            locality: "Toronto",
            district: null,
            region: "Ontario",
            regionCode: "ON",
            postcode: null,
            country: "Canada",
            countryCode: "CA",
          },
          context: {
            neighbourhood: null,
            sublocality: null,
            locality: null,
            district: null,
            region: {
              name: "Ontario",
              id: "osm:relation:68841",
              code: "CA-ON",
              wikidata: null,
              translations: null,
            },
            country: {
              name: "Canada",
              id: "osm:relation:1428125",
              code: "CA",
              wikidata: null,
              translations: null,
            },
          },
          addressDetails: {
            unitType: null,
            building: null,
            floor: null,
            sublocality: null,
            postcodeSuffix: null,
          },
          streetParts: null,
          translations: { fr: "Toronto" },
          bbox: null,
        },
      ],
      attribution: [
        {
          text: "© OpenStreetMap contributors",
          url: "https://www.openstreetmap.org/copyright",
          licence: "ODbL 1.0",
        },
        { text: "City of Toronto", url: null, licence: null },
      ],
      unavailable: [],
      ignored: [],
    });
  });

  // The fixture carries every field og can return, on one record, whatever the endpoint.
  const EVERY = [
    "bbox",
    "addressLines",
    "accessPoints",
    "contact",
    "openingHours",
    "timezone",
    "match",
    "highlights",
  ] as const;

  it("fills on each operation the fields og was given for it, and no others", async () => {
    const geo = geocoder(fakeFetch({ body: placesFixture }));
    const bbox = [-79.3903, 43.6486, -79.3899, 43.6488];
    const addressLines = ["200 Queen Street West", "Toronto ON M5V 1Z2", "Canada"];
    const accessPoints = [{ lat: 43.64865, lon: -79.39, kind: "main" }];
    const contact = {
      phone: "+1 416-555-0111",
      website: "https://queenbakery.example/",
      email: null,
    };
    const openingHours = { text: ["Mo-Fr 08:00-18:00; Sa 09:00-13:00"], openNow: null };
    const pick = (place: object): object =>
      Object.fromEntries(EVERY.map((key) => [key, (place as Record<string, unknown>)[key]]));

    const places = await geo.places("Queen Bakery", { include: EVERY });
    expect(pick(places.results[0]!)).toEqual({
      bbox,
      addressLines: null,
      accessPoints,
      contact,
      openingHours,
      timezone: { name: "America/Toronto", utcOffsetMinutes: expect.any(Number) },
      match: null,
      highlights: null,
    });
    expect([-300, -240]).toContain(places.results[0]!.timezone!.utcOffsetMinutes);
    expect(places.unavailable).toEqual(["addressLines", "match", "highlights"]);

    const forward = await geo.geocode("200 Quen St W M5V 9Z9", { include: EVERY });
    expect(pick(forward.results[0]!)).toEqual({
      bbox,
      addressLines,
      accessPoints,
      contact: null,
      openingHours: null,
      timezone: null,
      match: {
        score: null,
        label: null,
        components: { houseNumber: "matched", street: "partial", postcode: "unmatched" },
      },
      highlights: null,
    });
    expect(forward.unavailable).toEqual(["contact", "openingHours", "timezone", "highlights"]);

    const typed = await geo.autocomplete("queen wes", { include: EVERY });
    expect(pick(typed.results[0]!)).toEqual({
      bbox: null,
      addressLines: null,
      accessPoints: null,
      contact,
      openingHours,
      timezone: null,
      match: null,
      // og counts characters. The pastry is one character and two string units, so the second range moves by one.
      highlights: [
        { start: 0, end: 5 },
        { start: 17, end: 20 },
      ],
    });
    const { label } = typed.results[0]!;
    expect(
      typed.results[0]!.highlights!.map((range) => label.slice(range.start, range.end)),
    ).toEqual(["Queen", "200"]);

    const found = await geo.lookup("osm:way:77", { include: EVERY });
    expect(found.unavailable).toEqual(["distance", "match", "highlights"]);
    const back = await geo.reverse({ lat: 43.6487, lon: -79.3901 }, { include: EVERY });
    expect(back.unavailable).toEqual([
      "contact",
      "openingHours",
      "timezone",
      "match",
      "highlights",
    ]);
  });

  it("sends an address in parts to og's structured geocoder", async () => {
    const fetch = fakeFetch({ body: forwardFixture });
    await geocoder(fetch).geocode(
      { houseNumber: "10", street: "King St W", locality: "Toronto", region: "ON", country: "ca" },
      { types: ["address"] },
    );
    expect(Object.fromEntries(urlOf(fetch).searchParams)).toEqual({
      address: "10 King St W",
      locality: "Toronto",
      region: "ON",
      country: "CA",
    });
  });

  it("filters by one og layer on the server and by a longer list here", async () => {
    const fetch = fakeFetch({ body: forwardFixture });
    const geo = geocoder(fetch);
    const one = await geo.autocomplete("tor", { types: ["locality"] });
    expect(urlOf(fetch, 0).searchParams.get("layer")).toBe("locality");
    expect(one.results.map((place) => place.type)).toEqual(["locality"]);
    const two = await geo.places("tor", { types: ["locality", "poi"] });
    expect(urlOf(fetch, 1).searchParams.has("layer")).toBe(false);
    expect(two.results.map((place) => place.type)).toEqual(["locality"]);
  });

  it("reverses a point and looks ids up", async () => {
    const fetch = fakeFetch({ body: forwardFixture });
    const geo = geocoder(fetch);
    await geo.reverse({ lat: 43.65, lon: -79.38 }, { language: "fr", types: ["street"] });
    expect(urlOf(fetch, 0).href).toBe(
      "http://og.test/reverse?lat=43.65&lon=-79.38&lang=fr&layer=street",
    );
    await geo.lookup(["osm:node:1", "osm:way:2"]);
    expect(urlOf(fetch, 1).href).toBe("http://og.test/places?ids=osm%3Anode%3A1%2Cosm%3Away%3A2");
  });

  it("turns og's problem document into the one error class", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "q must not be empty",
      error_code: "invalid_query",
      request_id: "req-5",
    };
    const fetch = fakeFetch({ status: 400, body: problem });
    const error = (await geocoder(fetch)
      .geocode("")
      .catch((thrown: unknown) => thrown)) as GeocoderError;
    expect(error.code).toBe("invalid_request");
    expect(error.message).toBe("q must not be empty");
    expect(error.requestId).toBe("req-5");
    expect(error.provider).toBe("og");
    expect((error.cause as GeocoderError).name).toBe("BadRequestError");
    expect((error.cause as GeocoderError).problem).toEqual(problem);
  });

  it("runs a batch through /jobs and maps rows back by index", async () => {
    const status = {
      id: "j1",
      status: "completed",
      summary: { total: 2, succeeded: 1, failed: 1 },
    };
    const rows = [
      {
        row: 1,
        status: 400,
        error: { status: 400, error_code: "invalid_query", detail: "q must not be empty" },
      },
      { row: 0, id: "a", status: 200, response: forwardFixture },
    ];
    const fetch = fakeFetch(
      { status: 202, body: { ...status, status: "running" } },
      { body: rows.map((row) => JSON.stringify(row)).join("\n") },
      { body: status },
      { status: 204, body: "" },
    );
    const result = await geocoder(fetch).batch.geocode([{ id: "a", query: "10 King St W" }, ""], {
      countries: ["CA"],
      limit: 1,
    });
    const [create, lines, , remove] = fetch.mock.calls;
    expect(String(create![0])).toBe("http://og.test/jobs?endpoint=geocode");
    expect(create![1]!.body).toBe(
      '{"limit":1,"country":"CA","q":"10 King St W"}\n{"limit":1,"country":"CA","q":""}',
    );
    expect(String(lines![0])).toBe("http://og.test/jobs/j1/results");
    expect(remove![1]!.method).toBe("DELETE");
    expect(result.mode).toBe("native");
    expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(result.items[0]).toMatchObject({ index: 0, id: "a", error: null });
    expect(result.items[0]!.results).toHaveLength(1);
    expect(result.items[1]!.error?.code).toBe("invalid_request");
    expect(result.items[1]!.error?.message).toBe("q must not be empty");
  });

  it("keeps og's typed client as the escape hatch", async () => {
    const fetch = fakeFetch({ body: forwardFixture });
    const collection = await geocoder(fetch).native.geocode({ q: "x" });
    expect(collection.features).toHaveLength(2);
  });
});

it("lets a cache keep og's answers without limit", () => {
  const geo = new Geocoder({ adapter: og({ baseUrl: "http://og.test" }) });
  expect(geo.capabilities.cache).toEqual({ maxTtl: Infinity });
});

// Runs against a real og server when OG_URL is set, for example OG_URL=http://127.0.0.1:8081.
// OG_TEST_ADDRESS names an address the server's Pack holds. Default `24 Sussex Drive Ottawa`.
describe.runIf(process.env["OG_URL"])("against a live og", () => {
  // The body of a skipped suite still runs, so the adapter needs a URL either way.
  const baseUrl = process.env["OG_URL"] ?? "http://og.invalid";
  const query = process.env["OG_TEST_ADDRESS"] ?? "24 Sussex Drive Ottawa";
  const geo = new Geocoder({ adapter: og({ baseUrl }) });

  it("geocodes, reverses, looks up and suggests in one format", async () => {
    const forward = await geo
      .geocode(query, { limit: 1, include: ["context", "raw"] })
      .withResponse();
    expect(forward.requestId).toBeTruthy();
    const [hit] = forward.data.results;
    expect(hit).toBeDefined();
    expect(hit!.location).not.toBeNull();
    expect(hit!.address.countryCode).toMatch(/^[A-Z]{2}$/);
    expect(hit!.context?.country?.code).toBe(hit!.address.countryCode);
    expect(forward.data.attribution[0]!.text).toMatch(/OpenStreetMap/);
    expect(forward.data.raw).toHaveProperty("type", "FeatureCollection");

    const back = await geo.reverse(hit!.location!, { limit: 1 });
    expect(back.results[0]!.distance).toBeLessThan(50);

    const found = await geo.lookup(hit!.id!);
    // One id can be an address and the POI at it, and og's id lookup answers the POI.
    expect(found.results[0]!.id).toBe(hit!.id);
    expect(found.results[0]!.location).toEqual(hit!.location);
    expect((await geo.lookup("osm:node:1")).results).toEqual([]);

    const near = await geo.geocode(query, { limit: 1, focus: hit!.location! });
    expect(near.results[0]!.distance).toBeLessThan(50);

    const typed = await geo.autocomplete(query.slice(0, 12), { limit: 3 });
    expect(typed.results.length).toBeGreaterThan(0);
    expect(typed.results.every((place) => place.location !== null)).toBe(true);
  });

  it("returns the fields og was given, from a real Pack", async () => {
    const forward = await geo.geocode(query, {
      limit: 1,
      include: ["addressLines", "match", "bbox", "accessPoints"],
    });
    const [hit] = forward.results;
    expect(hit!.addressLines!.length).toBeGreaterThan(1);
    expect(hit!.match!.components.street).toBe("matched");
    expect(forward.unavailable).toEqual([]);

    const typed = await geo.autocomplete(query.slice(0, 12), { limit: 1, include: ["highlights"] });
    const suggestion = typed.results[0]!;
    expect(suggestion.highlights!.length).toBeGreaterThan(0);
    for (const range of suggestion.highlights!)
      expect(suggestion.label.slice(range.start, range.end)).not.toBe("");

    const area = await geo.lookup(hit!.id!, { include: ["bbox", "timezone", "contact"] });
    expect(area.unavailable).toEqual(["distance"]);
    // Present only when the Pack was built with timezone boundaries.
    const zone = area.results[0]!.timezone;
    if (zone !== null) {
      expect(zone.name).toMatch(/^[A-Z][A-Za-z_]+\/[A-Za-z_/]+$/);
      expect(Number.isInteger(zone.utcOffsetMinutes)).toBe(true);
    }
  });

  it("runs native batches through /jobs", async () => {
    const forward = await geo.batch.geocode([query, { id: "empty", query: "" }], { limit: 1 });
    expect(forward.mode).toBe("native");
    expect(forward.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(forward.items[1]!.error?.code).toBe("invalid_request");
    const point = forward.items[0]!.results[0]!.location!;
    const reverse = await geo.batch.reverse([{ ...point, id: "p" }]);
    expect(reverse.items[0]).toMatchObject({ id: "p", error: null });
    expect(reverse.items[0]!.results[0]!.distance).toBeLessThan(50);
  });

  it("reports og's own errors with normalised codes", async () => {
    await expect(geo.geocode("")).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(geo.reverse({ lat: 91, lon: 0 })).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("works under cache, failover and compare", async () => {
    const reports: CompareReport[] = [];
    const down = og({ baseUrl: "http://127.0.0.1:9", maxRetries: 0, logLevel: "off" });
    const live = og({ baseUrl });
    const stacked = new Geocoder({
      adapter: down,
      plugins: [
        cache(),
        failover({ to: live }),
        compare({ with: live, onReport: (report) => reports.push(report), wait: true }),
      ],
    });
    const first = await stacked.geocode(query, { limit: 1 }).withResponse();
    expect(first.data.provider).toBe("og");
    expect(first.data.results).toHaveLength(1);
    expect(reports[0]!.primary.error?.code).toBe("connection");
    expect(reports[0]!.candidate.result?.results).toHaveLength(1);
    const second = await stacked.geocode(query, { limit: 1 }).withResponse();
    expect(second.response).toBeUndefined();
    expect(second.data).toEqual(first.data);
  });
});
