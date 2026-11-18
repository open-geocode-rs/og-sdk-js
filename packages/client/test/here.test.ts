/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { here, type HereOptions } from "../src/here.ts";
import {
  AuthenticationError,
  BadRequestError,
  emptyAddress,
  Geocoder,
  GeocoderError,
} from "../src/index.ts";

const text = (name: string): string =>
  readFileSync(new URL(`./fixtures/here/${name}`, import.meta.url), "utf8");
const json = <T = unknown>(name: string): T => JSON.parse(text(name)) as T;

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Seen = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A fake HERE. `route` answers each request, and `calls` records them in order. */
function server(route: (seen: Seen, call: number) => Reply): {
  fetch: typeof globalThis.fetch;
  calls: Seen[];
} {
  const calls: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const seen: Seen = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: init?.body,
    };
    calls.push(seen);
    const reply = route(seen, calls.length - 1);
    const status = reply.status ?? 200;
    const body =
      status === 204
        ? null
        : typeof reply.body === "string"
          ? reply.body
          : JSON.stringify(reply.body ?? {});
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function geocoder(
  route: (seen: Seen, call: number) => Reply,
  options: HereOptions = { apiKey: "KEY" },
) {
  const fake = server(route);
  const adapter = here({ fetch: fake.fetch, logLevel: "off", maxRetries: 0, ...options });
  return { geo: new Geocoder({ adapter }), calls: fake.calls };
}

const GEOCODE = "https://geocode.search.hereapi.com/v1/geocode";

describe("translations", () => {
  it("asks for the further language HERE can name a result in, and maps the result's own name", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("geocode-localized.json") }));
    const result = await geo.geocode("皆原市", {
      language: ["ja", "ja-Hira", "en"],
      include: ["translations"],
    });
    const query = new URL(calls[0]!.url).searchParams;
    expect(query.get("lang")).toBe("ja,ja-Hira,en");
    // `en` is in the list too, but HERE names a result in a second language only for the ones it lists.
    expect(query.get("showLocalizedNames")).toBe("ja-Hira");
    expect(result.results[0]!.type).toBe("locality");
    expect(result.results[0]!.translations).toEqual({ "ja-Hira": "みなはらし" });
    // An address's name is put together from a number and a street, so it has no name to translate.
    expect(result.results[1]!.type).toBe("address");
    expect(result.results[1]!.translations).toBeNull();
    expect(result.unavailable).not.toContain("translations");
  });

  it("sends the list alone when no further name is asked for or none can be given", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("geocode-localized.json") }));
    await geo.geocode("皆原市", { language: ["ja", "ja-Hira"] });
    await geo.geocode("皆原市", { language: ["ja", "en"], include: ["translations"] });
    await geo.geocode("皆原市", { language: ["ja-Hira", "ja"], include: ["translations"] });
    await geo.reverse(
      { lat: 40.7, lon: 140.9 },
      { language: ["ja", "ja-hira"], include: ["translations"] },
    );
    const sent = calls.map((call) => new URL(call.url).searchParams);
    expect(sent.map((query) => query.get("lang"))).toEqual([
      "ja,ja-Hira",
      "ja,en",
      "ja-Hira,ja",
      "ja,ja-hira",
    ]);
    expect(sent.map((query) => query.get("showLocalizedNames"))).toEqual([
      null,
      null,
      // The first language already writes the answer, so it is no further name.
      null,
      "ja-Hira",
    ]);
  });
});
const BATCH = "https://batch.search.hereapi.com/v7/batch/jobs";
const JOB = "JOB-3e7c41d9-62ab-4f05-9b18-c0d5a7e2f643";

describe("geocode", () => {
  it("asks for the country info and maps an answer in the documented shape", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("geocode.json") }));
    const result = await geo.geocode("17 Quillfield Lane, Harrowmere VIC 3990, Australia", {
      include: ["bbox", "accessPoints", "match", "rating"],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(
      `${GEOCODE}?q=17+Quillfield+Lane%2C+Harrowmere+VIC+3990%2C+Australia&show=countryInfo&apiKey=KEY`,
    );
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(result).toEqual({
      provider: "here",
      operation: "geocode",
      results: [
        {
          id: "here:af:streetsection:Kq3.wZ8dTnR5uYhM2xLbVe:CgcIBCDq4rYxEAEaAjE3KGQ",
          type: "address",
          name: "17 Quillfield Lane",
          label: "17 Quillfield Lane, Harrowmere VIC 3999, Australia",
          location: { lat: -37.48216, lon: 144.90537 },
          accuracy: "rooftop",
          confidence: 0.94,
          distance: null,
          address: {
            houseNumber: "17",
            street: "Quillfield Lane",
            unit: null,
            neighbourhood: "Tannery Hill",
            locality: "Harrowmere",
            district: "Marrowby",
            region: "Victoria",
            regionCode: "VIC",
            postcode: "3999",
            country: "Australia",
            // The fixture has no `countryInfo`, as in the documented shape, so the alpha-3 `AUS` is converted.
            countryCode: "AU",
          },
          bbox: [144.90412, -37.48306, 144.90662, -37.48126],
          accessPoints: [{ lat: -37.48209, lon: 144.90544, kind: null }],
          match: {
            score: 0.94,
            label: null,
            components: {
              houseNumber: "matched",
              street: "matched",
              locality: "matched",
              postcode: "partial",
              country: "matched",
            },
          },
          rating: null,
        },
      ],
      attribution: [],
      unavailable: ["rating"],
      ignored: [],
    });
  });

  it("sends a structured address as a qualified query, with the options HERE honours", async () => {
    const item = {
      title: "24 Orrin St W, Dunmarrow, ON X9X 9X9, Canada",
      id: "here:af:streetsection:x",
      resultType: "houseNumber",
      houseNumberType: "interpolated",
      address: {
        label: "24 Orrin St W, Dunmarrow, ON X9X 9X9, Canada",
        countryCode: "CAN",
        countryName: "Canada",
        stateCode: "ON",
        state: "Ontario",
        city: "Dunmarrow",
        street: "Orrin St W",
        postalCode: "X9X 9X9",
        houseNumber: "24",
        unit: "Suite 5",
        building: "Calder Exchange",
      },
      position: { lat: 44.212, lng: -78.563 },
      distance: 95,
      timeZone: { name: "America/Toronto", utcOffset: "-05:00" },
      streetInfo: [{ baseName: "Orrin", streetType: "St", suffix: "W", language: "en" }],
      countryInfo: { alpha2: "CA", alpha3: "CAN" },
      secondaryUnitInfo: [{ normalizedUnitType: "Suite", unitValue: "5" }],
    };
    const { geo, calls } = geocoder(() => ({ body: { items: [item] } }));
    const result = await geo.geocode(
      { address: "24 Orrin St W; Suite 5", locality: "Dunmarrow", region: "ON", country: "CA" },
      {
        limit: 500,
        language: ["fr", "en"],
        focus: { lat: 44.2, lon: -78.6 },
        types: ["address", "street"],
        countries: ["ca", "US"],
        bounds: [-79, 44, -78, 45],
        session: "s1",
        include: ["timezone", "streetParts", "addressDetails", "raw"],
      },
    );
    const url = new URL(calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      qq: "street=24 Orrin St W  Suite 5;city=Dunmarrow;state=ON;country=CA",
      at: "44.2,-78.6",
      in: "countryCode:CAN,USA",
      types: "houseNumber,street",
      lang: "fr,en",
      limit: "100",
      show: "countryInfo,secondaryUnitInfo,streetInfo,tz",
      apiKey: "KEY",
    });
    expect(result.ignored).toEqual(["bounds", "session"]);
    expect(result.unavailable).toEqual([]);
    expect(result.raw).toEqual({ items: [item] });
    expect(result.results).toEqual([
      {
        id: "here:af:streetsection:x",
        type: "address",
        name: "24 Orrin St W",
        label: "24 Orrin St W, Dunmarrow, ON X9X 9X9, Canada",
        location: { lat: 44.212, lon: -78.563 },
        accuracy: "interpolated",
        confidence: null,
        distance: 95,
        address: {
          ...emptyAddress(),
          houseNumber: "24",
          street: "Orrin St W",
          unit: "Suite 5",
          locality: "Dunmarrow",
          region: "Ontario",
          regionCode: "ON",
          postcode: "X9X 9X9",
          country: "Canada",
          countryCode: "CA",
        },
        timezone: { name: "America/Toronto", utcOffsetMinutes: -300 },
        streetParts: { prefix: null, name: "Orrin", type: "St", suffix: "W" },
        addressDetails: {
          unitType: "Suite",
          building: "Calder Exchange",
          floor: null,
          sublocality: null,
          postcodeSuffix: null,
        },
        raw: item,
      },
    ]);
  });

  it("filters to the types asked for where HERE's own filter is wider", async () => {
    const items = [
      {
        title: "Ontario, Canada",
        id: "a",
        resultType: "administrativeArea",
        administrativeAreaType: "state",
        address: { state: "Ontario" },
      },
      {
        title: "Dunmarrow, ON, Canada",
        id: "b",
        resultType: "locality",
        localityType: "city",
        address: { city: "Dunmarrow" },
      },
      {
        title: "Canada",
        id: "c",
        resultType: "administrativeArea",
        administrativeAreaType: "country",
        address: { countryName: "Canada" },
      },
    ];
    const { geo, calls } = geocoder(() => ({ body: { items } }));
    const result = await geo.geocode("ontario", { types: ["region", "country"] });
    expect(new URL(calls[0]!.url).searchParams.get("types")).toBe("area");
    expect(result.results.map((place) => [place.type, place.name])).toEqual([
      ["region", "Ontario"],
      ["country", "Canada"],
    ]);
  });

  it("sends a bearer token in place of the key", async () => {
    let token = 0;
    const { geo, calls } = geocoder(() => ({ body: { items: [] } }), {
      apiKey: "KEY",
      bearerToken: () => `T${++token}`,
      baseUrls: { geocode: "http://proxy.test/here/" },
    });
    await geo.geocode("x");
    await geo.geocode("x");
    expect(calls[0]!.url).toBe("http://proxy.test/here/geocode?q=x&show=countryInfo");
    expect(calls.map((call) => call.headers["authorization"])).toEqual(["Bearer T1", "Bearer T2"]);
  });
});

describe("reverse", () => {
  it("maps an answer in the documented shape", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("revgeocode.json") }));
    const result = await geo.reverse(
      { lat: 60.4127512, lon: 5.3085231 },
      { language: "en-US", include: ["bbox"] },
    );
    expect(calls[0]!.url).toBe(
      "https://revgeocode.search.hereapi.com/v1/revgeocode?at=60.4127512%2C5.3085231&lang=en-US&show=countryInfo&apiKey=KEY",
    );
    expect(result.unavailable).toEqual(["confidence"]);
    expect(result.results).toEqual([
      {
        id: "here:af:streetsection:h7PdQ.x4LmWc9RtN0ayJsB:CgcIBCCv3M5kEAEaAjMx",
        type: "address",
        name: "Kvistmyrveien 31",
        label: "Kvistmyrveien 31, 5997 Skarvøy, Norway",
        location: { lat: 60.41273, lon: 5.30846 },
        accuracy: "rooftop",
        confidence: null,
        distance: 6,
        address: {
          ...emptyAddress(),
          houseNumber: "31",
          street: "Kvistmyrveien",
          neighbourhood: "Nordre Holmen",
          locality: "Skarvøy",
          district: "Skarvøy",
          region: "Vestland",
          postcode: "5997",
          country: "Norway",
          countryCode: "NO",
        },
        // Passed through as sent, even where west is the larger longitude.
        bbox: [5.31028, 60.41183, 5.30664, 60.41363],
      },
    ]);
  });
});

describe("autocomplete", () => {
  it("asks /autocomplete without a spatial reference, and its suggestions have no location", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("autocomplete.json") }));
    const result = await geo.autocomplete("Lerchen 4 Vald", {
      limit: 50,
      types: ["address", "street"],
      countries: ["CH"],
      include: ["highlights", "streetParts"],
    });
    expect(calls[0]!.url).toBe(
      "https://autocomplete.search.hereapi.com/v1/autocomplete?q=Lerchen+4+Vald&in=countryCode%3ACHE&types=houseNumber%2Cstreet&limit=20&show=streetInfo&apiKey=KEY",
    );
    expect(geo.capabilities.autocomplete?.coordinates).toBe(false);
    expect(result.ignored).toEqual([]);
    expect(result.unavailable).toEqual(["confidence"]);
    expect(result.results).toEqual([
      {
        id: "here:af:streetsection:Zr6TqN1.oXe4HcVb8mKdYA:CgcIBCD3kq1sEAEaATQ",
        type: "address",
        name: "Lerchenhalde 4",
        label: "Lerchenhalde 4, 7999 Valdrossa, Schweiz",
        location: null,
        accuracy: null,
        confidence: null,
        distance: null,
        address: {
          ...emptyAddress(),
          houseNumber: "4",
          street: "Lerchenhalde",
          neighbourhood: "Oberhalde",
          locality: "Valdrossa",
          district: "Valdrossa",
          region: "Graubünden",
          regionCode: "GR",
          postcode: "7999",
          country: "Schweiz",
          countryCode: "CH",
        },
        // The ranges of the address label, since that is the unified label.
        highlights: [
          { start: 0, end: 7 },
          { start: 13, end: 14 },
          { start: 21, end: 25 },
        ],
        streetParts: null,
      },
      {
        id: "here:af:streetsection:Wy2nJb.5GsUo7ErXp0cTqF",
        type: "street",
        name: "Lerchenweg",
        label: "Lerchenweg, 8999 Valdenried, Schweiz",
        location: null,
        accuracy: null,
        confidence: null,
        distance: null,
        address: {
          ...emptyAddress(),
          street: "Lerchenweg",
          neighbourhood: "Valdenried",
          locality: "Valdenried",
          district: "Valdenried",
          region: "Thurgau",
          regionCode: "TG",
          postcode: "8999",
          country: "Schweiz",
          countryCode: "CH",
        },
        highlights: [
          { start: 0, end: 7 },
          { start: 17, end: 21 },
        ],
        streetParts: null,
      },
    ]);
  });

  it("asks /autosuggest with a focus, and leaves out the query suggestions", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("autosuggest.json") }));
    const result = await geo.autocomplete("park", {
      focus: { lat: 35.48213, lon: -97.61054 },
      limit: 5,
      include: ["categories", "highlights", "accessPoints", "contact"],
    });
    expect(calls[0]!.url).toBe(
      "https://autosuggest.search.hereapi.com/v1/autosuggest?q=park&at=35.48213%2C-97.61054&limit=5&show=details&apiKey=KEY",
    );
    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({
      id: "here:pds:place:8409y6kq-7c3e91b5d2a84f6fb0e4a15c9d72e386",
      type: "poi",
      name: "Parkhollow Print Works",
      label: "Parkhollow Print Works, 2714 N Osprey Ave, Harrowmere, OK 73999-4102, United States",
      location: { lat: 35.46877, lon: -97.60391 },
      accuracy: "rooftop",
      confidence: null,
      distance: 1601,
      address: emptyAddress(),
      categories: [
        { id: "600-6700-0087", name: "Bookstore", primary: true },
        { id: "600-6900-0096", name: "Specialty Store", primary: false },
      ],
      highlights: [{ start: 0, end: 4 }],
      accessPoints: [{ lat: 35.46902, lon: -97.60448, kind: null }],
      contact: null,
    });
    expect(result.results.map((place) => place.highlights)).toEqual([
      [{ start: 0, end: 4 }],
      [],
      [{ start: 5, end: 9 }],
    ]);
  });

  it("sends countries to /autosuggest next to the centre", async () => {
    const { geo, calls } = geocoder(() => ({ body: { items: [], queryTerms: [] } }));
    await geo.autocomplete("park", { focus: { lat: 1, lon: 2 }, countries: ["US"] });
    await geo.autocomplete("park", { bounds: [1, 2, 3, 4], countries: ["US"] });
    expect(calls.map((call) => Object.fromEntries(new URL(call.url).searchParams))).toEqual([
      { q: "park", at: "1,2", in: "countryCode:USA", apiKey: "KEY" },
      // Next to a box the filter is applied here, which needs the address `details` carry.
      { q: "park", in: "bbox:1,2,3,4", show: "details", apiKey: "KEY" },
    ]);
  });

  it("sends bounds as a box, which HERE accepts only without a centre", async () => {
    const { geo, calls } = geocoder(() => ({ body: { items: [], queryTerms: [] } }));
    await geo.autocomplete("park", {
      focus: { lat: 1, lon: 2 },
      bounds: [7.41, 46.12, 7.93, 46.48],
    });
    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      q: "park",
      in: "bbox:7.41,46.12,7.93,46.48",
      apiKey: "KEY",
    });
  });
});

describe("places", () => {
  it("maps a discover answer in the documented shape", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("discover.json") }));
    const result = await geo.places("bakery", {
      focus: { lat: 44.61371, lon: -122.90405 },
      limit: 1,
      include: ["categories", "brand", "contact", "openingHours", "timezone"],
    });
    expect(calls[0]!.url).toBe(
      "https://discover.search.hereapi.com/v1/discover?q=bakery&at=44.61371%2C-122.90405&limit=1&show=tz&apiKey=KEY",
    );
    expect(result.unavailable).toEqual(["confidence"]);
    const [first] = result.results;
    expect(first).toEqual({
      id: "here:pds:place:8409rb7w-5d0e3a9c71f244b8a2c6e84f1b37d059",
      type: "poi",
      name: "Larkwhistle Bakehouse",
      label: "Larkwhistle Bakehouse, 38 Tannery Row, Quillfield, OR 97999-3120, United States",
      location: { lat: 44.61382, lon: -122.90417 },
      accuracy: "rooftop",
      confidence: null,
      distance: 15,
      address: {
        ...emptyAddress(),
        houseNumber: "38",
        street: "Tannery Row",
        neighbourhood: "Old Wharf",
        locality: "Quillfield",
        district: "Brindlemoor",
        region: "Oregon",
        regionCode: "OR",
        postcode: "97999-3120",
        country: "United States",
        // `/discover` has no `show=countryInfo`, so its alpha-3 `USA` is converted.
        countryCode: "US",
      },
      categories: [
        { id: "600-6300-0244", name: "Bakery & Baked Goods Store", primary: true },
        { id: "100-1100-0010", name: "Coffee Shop", primary: false },
        { id: "100-1100-0000", name: "Coffee-Tea", primary: false },
        { id: "100-1000-0001", name: "Casual Dining", primary: false },
        { id: "100-1000-0003", name: "Take Out & Delivery Only", primary: false },
        { id: "600-6300-0245", name: "Sweet Shop", primary: false },
        { id: "600-6900-0096", name: "Specialty Store", primary: false },
      ],
      brand: null,
      contact: {
        phone: "+15415550137",
        website: "http://www.larkwhistle-bakehouse.example",
        email: "hello@larkwhistle-bakehouse.example",
      },
      openingHours: { text: ["Tue-Sat: 07:00 - 15:00", "Mon: 08:30 - 13:00"], openNow: true },
      timezone: null,
    });
  });

  it("reads the chain as the brand", async () => {
    const item = {
      title: "Fennick Fuel",
      id: "here:pds:place:250u09tq-3c7a51e8d0b94f26a18e5d7f20c4b693",
      resultType: "place",
      address: { label: "Fennick Fuel, Corbeney, France" },
      position: { lat: 46.3, lng: 4.21 },
      access: [{ lat: 46.3, lng: 4.21, type: "parking" }],
      chains: [{ id: "4127", name: "Fennick" }],
    };
    const { geo, calls } = geocoder(() => ({ body: { items: [item] } }));
    const result = await geo.places("fennick", {
      bounds: [4, 46, 5, 47],
      include: ["brand", "accessPoints"],
    });
    expect(new URL(calls[0]!.url).searchParams.get("in")).toBe("bbox:4,46,5,47");
    expect(result.results[0]!.brand).toEqual({ name: "Fennick", id: "4127", wikidata: null });
    expect(result.results[0]!.accessPoints).toEqual([{ lat: 46.3, lon: 4.21, kind: "parking" }]);
  });

  it("sends countries next to a centre, and filters them itself next to a box", async () => {
    const { geo, calls } = geocoder(() => ({ body: json("discover.json") }));
    const near = { focus: { lat: 44.61371, lon: -122.90405 } };
    const boxed = { bounds: [-123, 44, -122, 45] as [number, number, number, number] };
    expect((await geo.places("bakery", { ...near, countries: ["us", "CA"] })).ignored).toEqual([]);
    expect((await geo.places("bakery", { ...boxed, countries: ["US"] })).results).toHaveLength(1);
    expect((await geo.places("bakery", { ...boxed, countries: ["CA"] })).results).toEqual([]);
    expect(calls.map((call) => new URL(call.url).searchParams.get("in"))).toEqual([
      "countryCode:USA,CAN",
      // HERE documents no way to write a box and a country filter in one `in`.
      "bbox:-123,44,-122,45",
      "bbox:-123,44,-122,45",
    ]);
    expect(new URL(calls[0]!.url).searchParams.get("at")).toBe("44.61371,-122.90405");
  });

  it("refuses a country code ISO does not list before asking HERE", async () => {
    const { geo, calls } = geocoder(() => ({ body: { items: [] } }));
    const options = { countries: ["CA", "ZZ"], focus: { lat: 1, lon: 2 } };
    for (const failed of [
      geo.geocode("x", options),
      geo.autocomplete("x", options),
      geo.autocomplete("x", { countries: ["ZZ"] }),
      geo.places("x", options),
      geo.batch.geocode(["x"], options),
    ]) {
      const error = (await failed.catch((e: unknown) => e)) as GeocoderError;
      expect(error).toBeInstanceOf(GeocoderError);
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("ZZ is not an ISO 3166-1 alpha-2 country code.");
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a search without a spatial reference before asking HERE", async () => {
    const { geo, calls } = geocoder(() => ({ body: { items: [] } }));
    const error = await geo.places("bakery", { countries: ["US"] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeocoderError);
    expect((error as GeocoderError).code).toBe("invalid_request");
    expect((error as GeocoderError).message).toBe(
      "HERE discover needs `focus` or `bounds`. `countries` narrows a search but cannot place it.",
    );
    expect(calls).toHaveLength(0);
  });
});

describe("lookup", () => {
  it("asks once per id and leaves out an id HERE does not know", async () => {
    const known = "here:pds:place:528u1k4f-9a62d7e0c3b54815bf07e2d4c618a93b";
    const { geo, calls } = geocoder((seen) =>
      new URL(seen.url).searchParams.get("id") === known
        ? { body: json("lookup.json") }
        : {
            status: 404,
            body: {
              status: 404,
              title: "No place has that id.",
              correlationId: "c",
              requestId: "r",
            },
          },
    );
    const result = await geo.lookup(["here:pds:place:gone", known], {
      language: "nl",
      include: ["contact", "categories", "businessStatus", "raw"],
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://lookup.search.hereapi.com/v1/lookup?id=here%3Apds%3Aplace%3Agone&lang=nl&show=countryInfo&apiKey=KEY",
      `https://lookup.search.hereapi.com/v1/lookup?id=${encodeURIComponent(known)}&lang=nl&show=countryInfo&apiKey=KEY`,
    ]);
    expect(result.unavailable).toEqual(["confidence", "distance"]);
    expect(result.raw).toEqual([json("lookup.json")]);
    expect(result.results).toEqual([
      {
        id: known,
        type: "poi",
        name: "Station Merelveen",
        label: "Station Merelveen, 1999 ZZ Merelveen, Nederland",
        location: { lat: 52.18342, lon: 5.90417 },
        accuracy: "rooftop",
        confidence: null,
        distance: null,
        address: {
          ...emptyAddress(),
          locality: "Merelveen",
          district: "Hoogerlanden",
          region: "Gelderland",
          regionCode: "GE",
          postcode: "1999 ZZ",
          country: "Nederland",
          countryCode: "NL",
        },
        contact: {
          phone: "+31555550142",
          website: "http://www.station-merelveen.example",
          email: "info@station-merelveen.example",
        },
        categories: [{ id: "400-4100-0035", name: "Treinstation", primary: true }],
        businessStatus: null,
        raw: json("lookup.json"),
      },
    ]);
  });

  it("answers nothing for an unknown id", async () => {
    const { geo } = geocoder(() => ({ status: 404, body: { status: 404, title: "Not found" } }));
    const answer = await geo.lookup("here:pds:place:gone").withResponse();
    expect(answer.data.results).toEqual([]);
    expect(answer.response).toBeUndefined();
  });

  it("fails when HERE fails for a reason other than an unknown id", async () => {
    const { geo } = geocoder(() => ({
      status: 429,
      body: { status: 429, title: "Rate limit exceeded" },
    }));
    await expect(geo.lookup("here:pds:place:x")).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("errors", () => {
  it("carries HERE's own message and the body", async () => {
    const body = json("error-400.json");
    const { geo } = geocoder(() => ({
      status: 400,
      body,
      headers: { "x-correlation-id": "6d1e0b47-93c2-4fa8-b750-2e8a41c9d3f6" },
    }));
    const error = (await geo.geocode("x").catch((e: unknown) => e)) as GeocoderError;
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error.code).toBe("invalid_request");
    expect(error.provider).toBe("here");
    expect(error.operation).toBe("geocode");
    expect(error.status).toBe(400);
    expect(error.requestId).toBe("6d1e0b47-93c2-4fa8-b750-2e8a41c9d3f6");
    expect(error.message).toBe(
      "Parameter 'lang' could not be read. Received value: 'xx_yy,q'. Send one BCP 47 language tag, such as 'en-GB'.",
    );
    expect(error.body).toEqual(body);
    expect(error.cause).toBeInstanceOf(BadRequestError);
  });

  it("reads the body HERE answers to missing credentials", async () => {
    const { geo } = geocoder(() => ({ status: 401, body: json("batch-401.json") }), {});
    const error = (await geo.reverse({ lat: 1, lon: 2 }).catch((e: unknown) => e)) as GeocoderError;
    expect(error.code).toBe("unauthenticated");
    expect(error.message).toBe("The request carried no credentials");
    expect(error.cause).toBeInstanceOf(AuthenticationError);
  });
});

describe("batch", () => {
  const completed = json<Record<string, unknown>>("job-completed.json");
  const created = json<{ id: string }>("job-created.json");

  it("runs a geocode job from upload to delete", async () => {
    const found = text("job-results.jsonl").trim().replace('"recId":"001"', '"recId":"0"');
    const refused = text("job-errors-backend.txt").trim().split("\n")[1]!.replace(/^1\|/, "2|");
    const lines = [
      "recId|q|qq|in=countryCode:DNK|limit=2|show=countryInfo",
      "0|Elmelyvej 73 6999 Ravnsbæk|",
      "1||street=24 Orrin St W;city=Dunmarrow",
      '2|"a|b ""c"""|',
      "3|x y|",
    ];
    const unparsed = `InputLine_4|999|${JSON.stringify({
      status: 999,
      recordId: "InputLine_4",
      title: "Input line rejected",
      cause: "The line does not follow the input format declared for the job.",
      action: "Correct the record, then send it in a new job.",
      jobRecord: lines[4],
    })}`;
    let polls = 0;
    const { geo, calls } = geocoder((seen) => {
      const { pathname } = new URL(seen.url);
      if (seen.method === "POST") return { status: 201, body: created };
      if (seen.method === "PUT") return { body: { ...created, status: "queued" } };
      if (seen.method === "DELETE") return { body: { ...created, status: "deleted" } };
      if (pathname.endsWith("/results"))
        return {
          body: `${found}\n{"recId":"1","results":[]}\n`,
          headers: { "content-type": "text/plain" },
        };
      if (pathname.endsWith("/errors"))
        return {
          body: `recId|errorCode|errorMessage\n${refused}\n${unparsed}\n`,
          headers: { "content-type": "text/plain" },
        };
      return ++polls === 1
        ? {
            body: {
              ...completed,
              status: "inProgress",
              records: { total: 4, processed: 1, invalid: 1 },
            },
          }
        : {
            body: {
              ...completed,
              records: {
                total: 4,
                valid: 3,
                invalid: 1,
                processed: 3,
                pending: 0,
                succeeded: 2,
                failed: 1,
              },
              errorsHref: `${BATCH}/${JOB}/errors`,
            },
          };
    });
    const progress: { done: number; total: number }[] = [];
    const result = await geo.batch.geocode(
      [
        { id: "first", query: "Elmelyvej 73 6999 Ravnsbæk" },
        { address: "24 Orrin St W", locality: "Dunmarrow" },
        'a|b "c"',
        "x\ny",
      ],
      { limit: 2, pollInterval: 1, countries: ["DK"], onProgress: (p) => progress.push(p) },
    );

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /v7/batch/jobs",
      `PUT /v7/batch/jobs/${JOB}/start`,
      `GET /v7/batch/jobs/${JOB}`,
      `GET /v7/batch/jobs/${JOB}`,
      `GET /v7/batch/jobs/${JOB}/results`,
      `GET /v7/batch/jobs/${JOB}/errors`,
      `DELETE /v7/batch/jobs/${JOB}`,
    ]);
    expect(calls[0]!.url).toBe(
      `${BATCH}?serviceHrn=hrn%3Ahere%3Aservice%3A%3Aolp-here%3Asearch-geocode-7&inputDelimiter=%7C&outputType=jsonl&startJob=false&apiKey=KEY`,
    );
    expect(calls[0]!.headers["content-type"]).toBe("text/plain; charset=UTF-8");
    expect(calls[0]!.body).toBe(lines.join("\n"));
    expect(calls[1]!.url).toBe(`${BATCH}/${JOB}/start?apiKey=KEY`);
    expect(calls[4]!.headers["accept"]).toBe("text/plain");
    expect(progress).toEqual([
      { done: 2, total: 4 },
      { done: 4, total: 4 },
    ]);

    expect(result).toMatchObject({
      provider: "here",
      operation: "batch.geocode",
      mode: "native",
      summary: { total: 4, succeeded: 2, failed: 2 },
      unavailable: [],
      ignored: [],
    });
    expect(result.items[0]).toEqual({
      index: 0,
      id: "first",
      error: null,
      results: [
        {
          id: "here:af:streetsection:Ue9cR.aV3oXwL6tGfB1qZk:CgcIBCDT8ZpHEAEaAjcz",
          // The line spells the result type in upper case, as the documented shape does.
          type: "address",
          name: "Elmelyvej 73",
          label: "Elmelyvej 73, 6999 Ravnsbæk, Danmark",
          location: { lat: 55.47183, lon: 9.13264 },
          accuracy: "rooftop",
          confidence: 1,
          distance: null,
          address: {
            ...emptyAddress(),
            houseNumber: "73",
            street: "Elmelyvej",
            neighbourhood: "Nørremark",
            locality: "Ravnsbæk",
            district: "Ravnsbæk",
            region: "Syddanmark",
            regionCode: "83",
            postcode: "6999",
            country: "Danmark",
            countryCode: "DK",
          },
        },
      ],
    });
    expect(result.items[1]).toEqual({ index: 1, id: null, results: [], error: null });
    const [, , backend, input] = result.items;
    expect(backend!.results).toEqual([]);
    expect(backend!.error).toMatchObject({
      code: "invalid_request",
      status: 400,
      operation: "batch.geocode",
      provider: "here",
    });
    expect(backend!.error!.message).toMatch(/^Parameter 'lang' could not be read\./);
    expect(backend!.error!.cause).toBeInstanceOf(BadRequestError);
    // The report names no record ID for a line HERE could not parse, so the quoted line finds the item.
    expect(input!.error).toMatchObject({ code: "invalid_request", status: 999 });
    expect(input!.error!.message).toMatch(/^Input line rejected\./);
  });

  it("runs a reverse job, and reports a record HERE answered nothing for", async () => {
    const { geo, calls } = geocoder((seen) => {
      if (seen.method === "POST") return { status: 201, body: created };
      if (seen.method !== "GET") return { body: created };
      if (seen.url.includes("/results")) return { body: '{"recId":"1","results":[]}\n' };
      return { body: completed };
    });
    const result = await geo.batch.reverse(
      [
        { lat: 55.47183, lon: 9.13264 },
        { lat: 55.47214, lon: 9.13302, id: "b" },
      ],
      { language: "en-US", types: ["address"], include: ["timezone"], pollInterval: 1 },
    );
    expect(new URL(calls[0]!.url).searchParams.get("serviceHrn")).toBe(
      "hrn:here:service::olp-here:search-revgeocode-7",
    );
    expect(calls[0]!.body).toBe(
      "recId|at|types=houseNumber|lang=en-US|show=countryInfo,tz\n0|55.47183,9.13264\n1|55.47214,9.13302",
    );
    // The status has an empty `errorsHref`, as the documented shape does, so no error report is fetched.
    expect(calls.some((call) => call.url.includes("/errors"))).toBe(false);
    expect(result.items[0]!.error).toMatchObject({ code: "provider_error" });
    expect(result.items[1]).toEqual({ index: 1, id: "b", results: [], error: null });
  });

  it("fails the batch when the job fails without a report, and still deletes it", async () => {
    const { geo, calls } = geocoder((seen) => {
      if (seen.method === "POST") return { status: 201, body: created };
      if (seen.method !== "GET") return { body: created };
      return { body: { ...json<Record<string, unknown>>("job-failure.json"), errorsHref: "" } };
    });
    const error = (await geo.batch
      .geocode(["x"], { pollInterval: 1 })
      .catch((e: unknown) => e)) as GeocoderError;
    expect(error.code).toBe("provider_error");
    expect(error.message).toBe(`HERE batch job ${JOB} failed.`);
    expect(calls.at(-1)!.method).toBe("DELETE");
  });

  it("stops polling when the caller aborts, and deletes the job", async () => {
    const controller = new AbortController();
    const { geo, calls } = geocoder((seen) => {
      if (seen.method === "POST") return { status: 201, body: created };
      if (seen.method === "GET") controller.abort();
      return { body: { ...completed, status: "inProgress" } };
    });
    await expect(
      geo.batch.geocode(["x"], { pollInterval: 5, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(calls.at(-1)!.method).toBe("DELETE");
  });

  it("reads an oversized input as too large, whatever the status", async () => {
    const { geo } = geocoder(() => ({
      status: 400,
      body: {
        title: "The input is larger than the service accepts",
        status: 400,
        code: "E6004003",
      },
    }));
    await expect(geo.batch.geocode(["x"])).rejects.toMatchObject({ code: "payload_too_large" });
  });
});

describe("native", () => {
  it("sends any request with the key, by service or by absolute URL", async () => {
    const { geo, calls } = geocoder(() => ({ body: { items: [] } }));
    await geo.native.request({
      service: "browse",
      path: "/browse",
      query: { at: "46.30125,4.21408", categories: "600-6300-0244,100-1100-0010" },
    });
    await geo.native.request({
      path: "https://geocode.search.hereapi.com/v1/geocode",
      query: { q: "x" },
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://browse.search.hereapi.com/v1/browse?at=46.30125%2C4.21408&categories=600-6300-0244%2C100-1100-0010&apiKey=KEY",
      `${GEOCODE}?q=x&apiKey=KEY`,
    ]);
    await expect(geo.native.request({ path: "/browse" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(calls).toHaveLength(2);
  });

  it("exposes the batch job calls", async () => {
    const stopped = json("job-stopped.json");
    const { geo, calls } = geocoder((seen) =>
      seen.url.includes("/errors") ? { status: 204 } : { body: stopped },
    );
    expect(await geo.native.batch.stop("JOB-1")).toEqual(stopped);
    expect(await geo.native.batch.errors("JOB-1")).toBe("");
    await geo.native.batch.create("recId|id\n1|here:pds:place:x", {
      service: "lookup",
      outputColumns: "position|title",
      tag: "t",
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PUT ${BATCH}/JOB-1/stop?apiKey=KEY`,
      `GET ${BATCH}/JOB-1/errors?apiKey=KEY`,
      `POST ${BATCH}?serviceHrn=hrn%3Ahere%3Aservice%3A%3Aolp-here%3Asearch-lookup-7&outputColumns=position%7Ctitle&tag=t&apiKey=KEY`,
    ]);
  });
});

describe.skipIf(!process.env["HERE_API_KEY"])("live", () => {
  const geo = new Geocoder({ adapter: here({ apiKey: process.env["HERE_API_KEY"] }) });

  it("geocodes and reverse geocodes", async () => {
    const forward = await geo.geocode("1600 Pennsylvania Avenue NW, Washington, DC 20500", {
      include: ["bbox"],
    });
    const [first] = forward.results;
    expect(first!.type).toBe("address");
    expect(first!.location).toEqual({ lat: expect.any(Number), lon: expect.any(Number) });
    expect(first!.address.countryCode).toBe("US");
    const back = await geo.reverse(first!.location!);
    expect(back.results[0]!.distance).toEqual(expect.any(Number));
  });

  it("suggests, and resolves a suggestion by its id", async () => {
    const suggestions = await geo.autocomplete("Pennsylvania Ave 1600 Wash");
    const [first] = suggestions.results;
    expect(first!.location).toBeNull();
    const resolved = await geo.lookup(first!.id!);
    expect(resolved.results[0]!.location).not.toBeNull();
    const near = await geo.autocomplete("park", { focus: { lat: 41.8781, lon: -87.6298 } });
    expect(near.results.every((place) => typeof place.label === "string")).toBe(true);
  });

  it("finds places", async () => {
    const found = await geo.places("bakery", {
      focus: { lat: 45.5152, lon: -122.6784 },
      limit: 3,
    });
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results[0]!.type).toBe("poi");
  });

  it("runs a batch job", { timeout: 300_000 }, async () => {
    const batch = await geo.batch.geocode(["1600 Pennsylvania Avenue NW Washington DC 20500"], {
      pollInterval: 2000,
    });
    expect(batch.mode).toBe("native");
    expect(batch.items).toHaveLength(1);
  });
});
