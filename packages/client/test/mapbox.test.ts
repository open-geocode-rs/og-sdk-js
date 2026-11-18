/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AuthenticationError, distance, Geocoder, GeocoderError } from "../src/index.ts";
import { mapbox } from "../src/mapbox.ts";

type Json = Record<string, any>;

/** A synthetic response in the shape Mapbox documents. */
function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/mapbox/${name}.json`, import.meta.url), "utf8"),
  ) as Json;
}

type Reply = { status?: number; body?: unknown };

/** A fake fetch that answers with each reply in turn. */
function fakeFetch(...replies: Reply[]) {
  let call = 0;
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const reply = replies[Math.min(call++, replies.length - 1)]!;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
}

function geocoder(fetch: ReturnType<typeof fakeFetch>, batchSize?: number) {
  return new Geocoder({
    adapter: mapbox({ accessToken: "tok", fetch, batchSize, logLevel: "off" }),
  });
}

/** The request the adapter sent on call `index`. */
function sent(fetch: ReturnType<typeof fakeFetch>, index = 0) {
  const [url, init] = fetch.mock.calls[index]!;
  return {
    method: init!.method,
    url: String(url),
    headers: init!.headers as Record<string, string>,
    body: typeof init!.body === "string" ? (JSON.parse(init!.body) as unknown) : undefined,
  };
}

const API = "https://api.mapbox.com";
const noDetails = {
  unitType: null,
  building: null,
  floor: null,
  sublocality: null,
  postcodeSuffix: null,
};
const area = (name: string, id: string | null, code: string | null, wikidata: string | null) => ({
  name,
  id,
  code,
  wikidata,
  translations: null,
});

describe("geocode", () => {
  it("sends a forward request and maps the synthetic response", async () => {
    const body = fixture("geocoding-forward");
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).geocode("418 Tannery Row", {
      limit: 2,
      language: "en",
      countries: ["us"],
      focus: { lat: 46.6, lon: -110.4 },
      bounds: [-110.7, 46.4, -110.1, 46.8],
      types: ["address"],
      include: ["match", "context", "bbox", "addressDetails", "accessPoints", "raw"],
    });
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/geocode/v6/forward?q=418+Tannery+Row&limit=2&language=en&country=US&proximity=-110.4%2C46.6&bbox=-110.7%2C46.4%2C-110.1%2C46.8&types=address&autocomplete=false&entrances=true&access_token=tok`,
    });
    expect(result.provider).toBe("mapbox");
    expect(result.operation).toBe("geocode");
    expect(result.unavailable).toEqual(["confidence"]);
    expect(result.ignored).toEqual([]);
    expect(result.raw).toEqual(body);
    // Mapbox sends the credit to show in each answer's own `attribution`, with the link in brackets.
    // Source: the `attribution` property in https://docs.mapbox.com/api/search/geocoding/.
    expect(result.attribution).toEqual([
      { text: body.attribution, url: "https://www.mapbox.com/about/maps/", licence: null },
    ]);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      id: "dXJuOm1ieGFkcjo0YmUwN2MxOS04M2EyLTRmNmQtYjVlMS0wN2M5ZDIxYTZmMzg",
      type: "address",
      name: "418 Tannery Row",
      label: "418 Tannery Row, Harrowmere, Montana 59917, United States",
      location: { lat: 46.587319, lon: -110.412736 },
      accuracy: "rooftop",
      confidence: null,
      distance: 1713.27,
      address: {
        houseNumber: "418",
        street: "Tannery Row",
        unit: null,
        neighbourhood: "Millrace",
        locality: "Harrowmere",
        district: "Corvane County",
        region: "Montana",
        regionCode: "MT",
        postcode: "59917",
        country: "United States",
        countryCode: "US",
      },
      match: {
        score: null,
        label: "low",
        components: {
          houseNumber: "matched",
          street: "matched",
          locality: "unmatched",
          region: "unmatched",
          postcode: "unmatched",
          country: "inferred",
        },
      },
      context: {
        neighbourhood: area("Millrace", "dXJuOm1ieHBsYzpNbFJjOHc", null, null),
        sublocality: null,
        locality: area("Harrowmere", "dXJuOm1ieHBsYzpId01lNlE", null, "Q973516840"),
        district: area("Corvane County", "dXJuOm1ieHBsYzpDclZrNVE", null, "Q951830274"),
        region: area("Montana", "dXJuOm1ieHBsYzpIdFp3", "US-MT", "Q962405183"),
        country: area("United States", "dXJuOm1ieHBsYzpRbTQ", "US", "Q940117302"),
      },
      bbox: null,
      addressDetails: noDetails,
      accessPoints: null,
      raw: body.features[0],
    });
    expect(result.results[1]).toMatchObject({
      accuracy: "interpolated",
      location: { lat: 46.590144, lon: -110.468205 },
      match: { label: "low", components: { houseNumber: "partial" } },
    });
  });

  it("keeps the request lean and returns only the default fields by default", async () => {
    const fetch = fakeFetch({ body: fixture("geocoding-forward") });
    const result = await geocoder(fetch).geocode("418 Tannery Row");
    expect(sent(fetch).url).toBe(
      `${API}/search/geocode/v6/forward?q=418+Tannery+Row&autocomplete=false&access_token=tok`,
    );
    expect(Object.keys(result.results[0]!)).toEqual([
      "id",
      "type",
      "name",
      "label",
      "location",
      "accuracy",
      "confidence",
      "distance",
      "address",
    ]);
    expect("raw" in result).toBe(false);
  });

  it("sends a structured address in parts", async () => {
    const part = fixture("geocoding-match-code");
    const body = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { feature_type: "address", ...part } }],
    };
    const fetch = fakeFetch({ body });
    const geo = geocoder(fetch);
    const result = await geo.geocode(
      {
        houseNumber: "73",
        street: "Larkspur Bend",
        locality: "Osterby",
        region: "AZ",
        postcode: "89473",
        country: "US",
      },
      { include: ["match"] },
    );
    expect(sent(fetch).url).toBe(
      `${API}/search/geocode/v6/forward?address_number=73&street=Larkspur+Bend&place=Osterby&region=AZ&postcode=89473&country=US&autocomplete=false&access_token=tok`,
    );
    expect(result.ignored).toEqual([]);
    expect(result.results[0]).toMatchObject({
      name: "73 Larkspur Bend",
      label: "73 Larkspur Bend, Osterby, Nevada 89473, United States",
      location: null,
      match: {
        score: null,
        label: "medium",
        components: {
          houseNumber: "matched",
          street: "matched",
          locality: "unmatched",
          region: "unmatched",
          postcode: "matched",
          country: "inferred",
        },
      },
    });
    const match = result.results[0]!.match!;
    expect(match.label).toBe("medium");

    await geo.geocode({ address: "12 Fennel Wharf", country: "Ireland" }, { countries: ["ie"] });
    expect(sent(fetch, 1).url).toBe(
      `${API}/search/geocode/v6/forward?address_line1=12+Fennel+Wharf&country=IE&autocomplete=false&access_token=tok`,
    );
  });

  it("reports what Mapbox cannot honour or fill", async () => {
    const fetch = fakeFetch({ body: fixture("geocoding-forward") });
    const result = await geocoder(fetch).geocode("418 Tannery Row", {
      session: "s1",
      include: ["timezone", "rating", "match"],
    });
    expect(sent(fetch).url).not.toContain("session");
    expect(result.ignored).toEqual(["session"]);
    expect(result.unavailable).toEqual(["confidence", "distance", "timezone", "rating"]);
    expect(result.results[0]).toMatchObject({ confidence: null, timezone: null, rating: null });
  });

  it("reads an intersection from a street feature and filters by unified type", async () => {
    const body = fixture("geocoding-intersection");
    const fetch = fakeFetch({ body });
    const geo = geocoder(fetch);
    const result = await geo.geocode("Cooper Lane and Vesper Street", {
      types: ["intersection"],
    });
    expect(sent(fetch).url).toContain("&types=street&");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      type: "intersection",
      name: "Cooper Lane and Vesper Street",
      label: "Cooper Lane and Vesper Street, Marrowgate, Idaho 83857, United States",
      accuracy: "street",
      location: { lat: 44.428615, lon: -115.317462 },
      address: { houseNumber: null, street: "Vesper Street", locality: "Marrowgate" },
    });

    const streets = await geo.geocode("Cooper Lane", { types: ["street"] });
    expect(streets.results).toEqual([]);

    // `area` has no single Mapbox type, so nothing is sent and the filter runs here.
    const areas = await geo.geocode("Cooper Lane", { types: ["area", "street"] });
    expect(sent(fetch, 2).url).not.toContain("types=");
    expect(areas.results).toEqual([]);
  });

  it("maps context translations when several languages are asked for", async () => {
    const body = fixture("geocoding-forward");
    body.features[0].properties.context = fixture("geocoding-context-translations").context;
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).geocode("Kesselgasse 14", {
      language: ["en", "es"],
      include: ["context"],
    });
    expect(sent(fetch).url).toContain("&language=en%2Ces&");
    const context = result.results[0]!.context!;
    expect(context.region).toEqual({
      name: "Bavaria",
      id: "dXJuOm1ieHBsYzpCeVJu",
      code: "DE-BY",
      wikidata: "Q939172650",
      // The first language already names the area, so only the further one is a translation.
      translations: { es: "Baviera" },
    });
    expect(context.country?.translations).toEqual({ es: "Alemania" });
    expect(context.neighbourhood?.translations).toEqual({ es: "Hopfenanger" });
    expect(context.district).toBeNull();
  });

  it("fills a result's own translations from its entry in its own context", async () => {
    const { context } = fixture("geocoding-context-translations");
    const region = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [11.4, 48.9] },
      properties: {
        mapbox_id: context.region.mapbox_id,
        feature_type: "region",
        name: "Bavaria",
        place_formatted: "Germany",
        // A feature is listed in its own context, under its own ID.
        context: { region: context.region, country: context.country },
      },
    };
    const street = fixture("geocoding-forward").features[0];
    street.properties.context = context;
    const fetch = fakeFetch({ body: { type: "FeatureCollection", features: [region, street] } });
    const geo = geocoder(fetch);

    const forward = await geo.geocode("Bavaria", {
      language: ["en", "es", "fr"],
      include: ["translations"],
    });
    expect(sent(fetch).url).toContain("&language=en%2Ces%2Cfr&");
    expect(forward.results[0]!.translations).toEqual({ es: "Baviera" });
    // An address has no name of its own in another language, though its areas do.
    expect(forward.results[1]!.translations).toBeNull();
    expect(forward.unavailable).not.toContain("translations");

    const back = await geo.reverse(
      { lat: 48.9, lon: 11.4 },
      { language: ["es", "en"], include: ["translations"] },
    );
    expect(sent(fetch, 1).url).toContain("&language=es%2Cen&");
    // The first language asked for is the one left out, whichever it is.
    expect(back.results[0]!.translations).toEqual({ en: "Bavaria" });
    expect(back.unavailable).not.toContain("translations");

    // Search Box names a result in one language only, so it has no translations to give.
    const places = await geo.places("Bavaria", {
      language: ["en", "es"],
      include: ["translations"],
    });
    expect(places.unavailable).toContain("translations");
  });

  it("maps units, sublocalities, boxes and routable points", async () => {
    const body = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-72.64, 44.31] },
          properties: {
            mapbox_id: "unit-1",
            feature_type: "secondary_address",
            name: "27 Orchard Wynd Unit 4B",
            coordinates: {
              longitude: -72.64,
              latitude: 44.31,
              accuracy: "parcel",
              routable_points: [{ name: "default", longitude: -72.641, latitude: 44.311 }],
            },
            context: {
              address: { address_number: "27", street_name: "Orchard Wynd" },
              secondary_address: { designator: "UNIT", identifier: "4B" },
              locality: { mapbox_id: "loc-1", name: "Lower Pell", wikidata_id: "Q985627105" },
              country: { name: "United States", country_code: "us" },
            },
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-72.7, 43.9] },
          properties: {
            mapbox_id: "region-1",
            feature_type: "region",
            name: "Vermont",
            bbox: [-73.44, 42.73, -71.47, 45.02],
            coordinates: { longitude: -72.7, latitude: 43.9 },
            context: {},
          },
        },
      ],
    };
    const result = await geocoder(fakeFetch({ body })).geocode("x", {
      include: ["addressDetails", "accessPoints", "bbox", "context"],
    });
    expect(result.results[0]).toMatchObject({
      type: "address",
      accuracy: "rooftop",
      address: { houseNumber: "27", street: "Orchard Wynd", unit: "4B", countryCode: "US" },
      addressDetails: { ...noDetails, unitType: "UNIT", sublocality: "Lower Pell" },
      accessPoints: [{ lat: 44.311, lon: -72.641, kind: "default" }],
      bbox: null,
      context: { sublocality: area("Lower Pell", "loc-1", null, "Q985627105") },
    });
    expect(result.results[1]).toMatchObject({
      type: "region",
      label: "Vermont",
      accuracy: null,
      address: { region: "Vermont", regionCode: null },
      bbox: [-73.44, 42.73, -71.47, 45.02],
      accessPoints: null,
    });
  });
});

describe("reverse", () => {
  const point = { lat: 44.312747, lon: -72.641827 };

  it("sends a reverse request and measures the distance from the point", async () => {
    const body = fixture("geocoding-batch").batch[2];
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).reverse(point, {
      language: "en",
      types: ["address"],
      limit: 3,
      include: ["match"],
    });
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/geocode/v6/reverse?longitude=-72.641827&latitude=44.312747&language=en&types=address&limit=3&access_token=tok`,
    });
    expect(result.unavailable).toEqual(["confidence", "match"]);
    const place = result.results[0]!;
    expect(place).toMatchObject({
      id: "dXJuOm1ieGFkcjowZDk2YTNjOC1mNTE3LTQyYmUtOGE0MC1lNmI5MjczYzE1ZmQ",
      type: "address",
      name: "27 Orchard Wynd",
      label: "27 Orchard Wynd, Thistlecombe, Vermont 05873, United States",
      location: { lat: 44.3127465, lon: -72.6418273 },
      accuracy: "rooftop",
      confidence: null,
      match: null,
      address: {
        houseNumber: "27",
        street: "Orchard Wynd",
        unit: null,
        neighbourhood: "Candlewick",
        locality: "Thistlecombe",
        district: "Ashgrove County",
        region: "Vermont",
        regionCode: "VT",
        postcode: "05873",
        country: "United States",
        countryCode: "US",
      },
    });
    expect(place.distance).toBe(0.06);
    expect(place.distance).toBeLessThan(1);
  });

  it("leaves the limit out unless exactly one type is asked for", async () => {
    const fetch = fakeFetch({ body: fixture("geocoding-batch").batch[2] });
    const geo = geocoder(fetch);
    await geo.reverse(point, { limit: 3 });
    expect(sent(fetch, 0).url).toBe(
      `${API}/search/geocode/v6/reverse?longitude=-72.641827&latitude=44.312747&access_token=tok`,
    );
    await geo.reverse(point, { limit: 9, types: ["locality"] });
    expect(sent(fetch, 1).url).toBe(
      `${API}/search/geocode/v6/reverse?longitude=-72.641827&latitude=44.312747&types=place&limit=5&access_token=tok`,
    );
  });
});

describe("autocomplete", () => {
  it("sends a suggest request and maps the synthetic suggestion", async () => {
    const body = fixture("searchbox-suggest");
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).autocomplete("Calloway Lantern Museum", {
      language: "en",
      limit: 1,
      session: "session-7c2e",
      focus: { lat: 43.418514, lon: -89.631242 },
      countries: ["US"],
      include: ["categories", "brand", "context", "businessStatus", "bbox"],
    });
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/searchbox/v1/suggest?q=Calloway+Lantern+Museum&types=country%2Cregion%2Cpostcode%2Cdistrict%2Cplace%2Clocality%2Cneighborhood%2Cblock%2Cstreet%2Caddress%2Cpoi&limit=1&language=en&country=US&proximity=-89.631242%2C43.418514&session_token=session-7c2e&access_token=tok`,
    });
    expect(result.unavailable).toEqual(["location", "accuracy", "confidence", "bbox"]);
    expect(result.ignored).toEqual([]);
    expect(result.attribution[0]!.text).toBe(body.attribution);
    expect(result.results).toEqual([
      {
        id: "dXJuOm1ieHBvaTo2YTQwZDJmOS1iODcxLTRlM2MtOGQwNS1jMmY3OTEzYWU2YjA",
        type: "poi",
        name: "Calloway Lantern Museum",
        label:
          "Calloway Lantern Museum, 58 Foundry Passage, Dunster Falls, Wisconsin 53962, United States",
        location: null,
        accuracy: null,
        confidence: null,
        distance: null,
        address: {
          houseNumber: "58",
          street: "Foundry Passage",
          unit: null,
          neighbourhood: "Glassworks",
          locality: "Dunster Falls",
          district: null,
          region: "Wisconsin",
          regionCode: "WI",
          postcode: "53962",
          country: "United States",
          countryCode: "US",
        },
        categories: [
          { id: "museum", name: "museum", primary: false },
          { id: "tourist_attraction", name: "tourist attraction", primary: false },
        ],
        brand: null,
        context: {
          neighbourhood: area("Glassworks", "dXJuOm1ieHBsYzpHd0tzNHc", null, null),
          sublocality: null,
          locality: area("Dunster Falls", "dXJuOm1ieHBsYzpEc0ZsOFE", null, null),
          district: null,
          region: area("Wisconsin", null, "US-WI", null),
          country: area("United States", null, "US", null),
        },
        businessStatus: null,
        bbox: null,
      },
    ]);
  });

  it("declares that suggestions carry no coordinates", () => {
    const geo = geocoder(fakeFetch());
    expect(geo.capabilities.autocomplete?.coordinates).toBe(false);
    expect(geo.capabilities.batch).toEqual({ geocode: "native", reverse: "native" });
  });

  it("makes a session token when the caller gave none", async () => {
    const fetch = fakeFetch({ body: fixture("searchbox-suggest") });
    await geocoder(fetch).autocomplete("Call");
    const token = new URL(sent(fetch).url).searchParams.get("session_token");
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("leaves out category and brand suggestions", async () => {
    const body = fixture("searchbox-suggest");
    body.suggestions.unshift(
      { name: "Coffee", mapbox_id: "category-1", feature_type: "category" },
      { name: "Tarnbrew", mapbox_id: "brand-1", feature_type: "brand" },
    );
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).autocomplete("coff", { types: ["poi", "address"] });
    expect(new URL(sent(fetch).url).searchParams.get("types")).toBe("poi,address");
    expect(result.results.map((place) => place.name)).toEqual(["Calloway Lantern Museum"]);
  });
});

describe("places", () => {
  it("sends a Search Box forward request and maps the synthetic address", async () => {
    const body = fixture("searchbox-forward");
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).places("2908 Wrenfold Court", {
      limit: 20,
      bounds: [-106, 39, -104, 40],
      session: "s1",
      include: ["accessPoints", "contact", "raw"],
    });
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/searchbox/v1/forward?q=2908+Wrenfold+Court&limit=10&bbox=-106%2C39%2C-104%2C40&access_token=tok`,
    });
    expect(result.ignored).toEqual(["session"]);
    expect(result.unavailable).toEqual(["confidence"]);
    expect(result.raw).toEqual(body);
    expect(result.results).toEqual([
      {
        id: "dXJuOm1ieGFkcjplMjRmOGIwNi0zYTdkLTRjMTktOTVkMi1iMDhjNmUxZjdhNDM",
        type: "address",
        name: "2908 Wrenfold Court",
        label: "2908 Wrenfold Court, Pellham Ridge, Colorado 80471, United States",
        location: { lat: 39.612905, lon: -105.137482 },
        accuracy: "rooftop",
        confidence: null,
        distance: 8312,
        address: {
          houseNumber: "2908",
          street: "Wrenfold Court",
          unit: null,
          neighbourhood: "Farrowdale",
          locality: "Pellham Ridge",
          district: "Sablewood County",
          region: "Colorado",
          regionCode: "CO",
          postcode: "80471",
          country: "United States",
          countryCode: "US",
        },
        accessPoints: [{ lat: 39.612771, lon: -105.137533, kind: "Address" }],
        contact: null,
        raw: body.features[0],
      },
    ]);
  });

  it("maps the POI fields of a Search Box feature", async () => {
    // A category search answers with the same feature collection as `/forward`.
    const fetch = fakeFetch({ body: fixture("searchbox-category") });
    const result = await geocoder(fetch).places("Tarnbrew", {
      types: ["poi"],
      include: ["categories", "brand", "contact", "openingHours", "rating", "businessStatus"],
    });
    expect(sent(fetch).url).toBe(
      `${API}/search/searchbox/v1/forward?q=Tarnbrew&types=poi&access_token=tok`,
    );
    expect(result.unavailable).toEqual(["confidence"]);
    expect(result.results[0]).toMatchObject({
      type: "poi",
      name: "Tarnbrew",
      label: "Tarnbrew, 742 Cinder Mill Road, Oakhollow, Oregon 97388, United States",
      location: { lat: 44.0518327, lon: -123.2071468 },
      accuracy: null,
      distance: 6427,
      categories: [
        { id: "bakery", name: "bakery", primary: false },
        { id: "cafe", name: "café", primary: false },
        { id: "coffee_shop", name: "coffee shop", primary: false },
        { id: "food_and_drink", name: "food and drink", primary: false },
        { id: "food", name: "food", primary: false },
      ],
      brand: { name: "Tarnbrew", id: "tarnbrew", wikidata: null },
      contact: {
        phone: "+1 541 555 0137",
        website: "https://tarnbrew.example/oakhollow",
        email: null,
      },
      // The fixture carries `periods` only, and no display lines to pass on.
      openingHours: null,
      rating: null,
      businessStatus: null,
    });
  });

  it("maps display hours, ratings and a closed status when Mapbox sends them", async () => {
    const body = fixture("searchbox-category");
    const properties = body.features[0].properties;
    properties.metadata = {
      email: "hello@example.com",
      rating: 4.2,
      review_count: 17,
      open_hours: { weekday_text: ["Monday: 6:15 AM - 7:30 PM"] },
    };
    properties.operational_status = "closed";
    properties.poi_category_ids = ["bakery"];
    const result = await geocoder(fakeFetch({ body })).places("Tarnbrew", {
      include: ["categories", "contact", "openingHours", "rating", "businessStatus"],
    });
    expect(result.results[0]).toMatchObject({
      contact: { phone: null, website: null, email: "hello@example.com" },
      openingHours: { text: ["Monday: 6:15 AM - 7:30 PM"], openNow: null },
      rating: { value: 4.2, count: 17 },
      businessStatus: "closed_permanently",
    });
    expect(result.results[0]!.categories).toHaveLength(6);
    expect(result.results[0]!.categories!.at(-1)).toEqual({
      id: "bakery",
      name: null,
      primary: false,
    });
  });
});

describe("lookup", () => {
  it("retrieves one record per id and maps the synthetic feature", async () => {
    const body = fixture("searchbox-retrieve");
    const fetch = fakeFetch({ body });
    const result = await geocoder(fetch).lookup(
      "dXJuOm1ieHBvaTo2YTQwZDJmOS1iODcxLTRlM2MtOGQwNS1jMmY3OTEzYWU2YjA",
      {
        language: "en",
        session: "session-7c2e",
        include: ["contact", "rating", "businessStatus", "accessPoints", "categories", "raw"],
      },
    );
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/searchbox/v1/retrieve/dXJuOm1ieHBvaTo2YTQwZDJmOS1iODcxLTRlM2MtOGQwNS1jMmY3OTEzYWU2YjA?language=en&attribute_sets=visit%2Cvenue&session_token=session-7c2e&access_token=tok`,
    });
    expect(result.unavailable).toEqual(["confidence", "distance"]);
    expect(result.raw).toEqual([body]);
    expect(result.results).toEqual([
      {
        id: "dXJuOm1ieHBvaTo2YTQwZDJmOS1iODcxLTRlM2MtOGQwNS1jMmY3OTEzYWU2YjA",
        type: "poi",
        name: "Calloway Lantern Museum",
        label:
          "Calloway Lantern Museum, 58 Foundry Passage, Dunster Falls, Wisconsin 53962, United States",
        location: { lat: 43.41856203917482, lon: -89.63127485206913 },
        accuracy: null,
        confidence: null,
        distance: null,
        address: {
          houseNumber: "58",
          street: "foundry passage",
          unit: null,
          neighbourhood: "Glassworks",
          locality: "Dunster Falls",
          district: null,
          region: "Wisconsin",
          regionCode: "WI",
          postcode: "53962",
          country: "United States",
          countryCode: "US",
        },
        contact: {
          phone: "+1 608 555 0142",
          website: "https://lantern-museum.example",
          email: null,
        },
        rating: { value: 4.37, count: null },
        businessStatus: "operational",
        accessPoints: [{ lat: 43.418497160285, lon: -89.63204917356283, kind: "POI" }],
        categories: [
          { id: "museum", name: "museum", primary: false },
          { id: "tourist_attraction", name: "tourist attraction", primary: false },
        ],
        raw: body.features[0],
      },
    ]);
  });

  it("asks for no attribute set and makes a session token by default", async () => {
    const fetch = fakeFetch({ body: fixture("searchbox-retrieve") });
    await geocoder(fetch).lookup("abc/1");
    const url = new URL(sent(fetch).url);
    expect(url.pathname).toBe("/search/searchbox/v1/retrieve/abc%2F1");
    expect([...url.searchParams.keys()]).toEqual(["session_token", "access_token"]);
    expect(url.searchParams.get("session_token")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers nothing for an unknown id", async () => {
    const missing = { status: 404, body: { message: "Not Found" } };
    const fetch = fakeFetch(missing);
    const result = await geocoder(fetch).lookup("nope", { include: ["raw"] });
    expect(result.results).toEqual([]);
    expect(result.raw).toEqual([{ message: "Not Found" }]);

    const mixed = fakeFetch({ body: fixture("searchbox-retrieve") }, missing);
    const both = await geocoder(mixed).lookup([
      "dXJuOm1ieHBvaTo2YTQwZDJmOS1iODcxLTRlM2MtOGQwNS1jMmY3OTEzYWU2YjA",
      "nope",
    ]);
    expect(mixed).toHaveBeenCalledTimes(2);
    expect(both.results.map((place) => place.name)).toEqual(["Calloway Lantern Museum"]);
  });

  it("fails when Mapbox refuses a retrieve for another reason", async () => {
    const fetch = fakeFetch({ status: 401, body: { message: "Not authorized" } });
    await expect(geocoder(fetch).lookup("x")).rejects.toMatchObject({
      code: "unauthenticated",
      message: "Not authorized",
    });
  });
});

describe("batch", () => {
  const address = "305 Heronsgate Avenue E, Brackenholt, ON K7R 2M4, Canada";

  it("geocodes through the batch endpoint", async () => {
    const [first, second] = fixture("geocoding-batch").batch;
    const fetch = fakeFetch({ body: { batch: [first, second] } });
    const result = await geocoder(fetch).batch.geocode([address, { id: "b", query: "zqxvwkpt" }], {
      types: ["address"],
      bounds: [-79, 44, -77, 45],
      limit: 1,
      include: ["match"],
    });
    const request = sent(fetch);
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${API}/search/geocode/v6/batch?access_token=tok`);
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.body).toEqual([
      { q: address, limit: 1, bbox: "-79,44,-77,45", types: "address", autocomplete: false },
      { q: "zqxvwkpt", limit: 1, bbox: "-79,44,-77,45", types: "address", autocomplete: false },
    ]);
    expect(result).toMatchObject({
      provider: "mapbox",
      operation: "batch.geocode",
      mode: "native",
      summary: { total: 2, succeeded: 2, failed: 0 },
      unavailable: ["confidence", "distance"],
      ignored: [],
    });
    expect(result.items[0]).toMatchObject({ index: 0, id: null, error: null });
    expect(result.items[0]!.results).toEqual([
      {
        id: "dXJuOm1ieGFkcjo1OGUxYjdmNC05ZDAyLTRhNmMtYjNlOC0yYzcxZjBhNWQ5NDY",
        type: "address",
        name: "305 Heronsgate Avenue East",
        label: "305 Heronsgate Avenue East, Brackenholt, Ontario K7R 2M4, Canada",
        location: { lat: 44.61853, lon: -78.31427 },
        accuracy: "rooftop",
        confidence: null,
        distance: null,
        address: {
          houseNumber: "305",
          street: "Heronsgate Avenue East",
          unit: null,
          neighbourhood: "Weirside",
          locality: "Brackenholt",
          district: null,
          region: "Ontario",
          regionCode: "ON",
          postcode: "K7R 2M4",
          country: "Canada",
          countryCode: "CA",
        },
        match: {
          score: null,
          label: "exact",
          components: {
            houseNumber: "matched",
            street: "matched",
            locality: "matched",
            region: "matched",
            postcode: "matched",
            country: "inferred",
          },
        },
      },
    ]);
    expect(result.items[1]).toEqual({ index: 1, id: "b", results: [], error: null });
  });

  it("splits a batch into chunks and keeps a failed chunk's errors per item", async () => {
    const [first, second] = fixture("geocoding-batch").batch;
    const fetch = fakeFetch(
      { body: { batch: [first, second] } },
      { status: 422, body: { message: "Batch queries must include 50 queries or less" } },
    );
    const progress: { done: number; total: number }[] = [];
    const result = await geocoder(fetch, 2).batch.geocode(
      [
        address,
        "zqxvwkpt",
        { address: "27 Orchard Wynd", locality: "Thistlecombe", country: "US" },
      ],
      { concurrency: 1, onProgress: (step) => progress.push(step) },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sent(fetch, 0).body).toHaveLength(2);
    expect(sent(fetch, 1).body).toEqual([
      {
        address_line1: "27 Orchard Wynd",
        place: "Thistlecombe",
        country: "US",
        autocomplete: false,
      },
    ]);
    expect(progress).toEqual([
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(result.summary).toEqual({ total: 3, succeeded: 2, failed: 1 });
    expect(result.items[0]!.results).toHaveLength(1);
    const failed = result.items[2]!;
    expect(failed.results).toEqual([]);
    expect(failed.error).toBeInstanceOf(GeocoderError);
    expect(failed.error).toMatchObject({
      code: "payload_too_large",
      status: 422,
      message: "Batch queries must include 50 queries or less",
      operation: "batch.geocode",
      provider: "mapbox",
    });
  });

  it("marks a query Mapbox left unanswered as failed", async () => {
    const [first] = fixture("geocoding-batch").batch;
    const fetch = fakeFetch({ body: { batch: [first] } });
    const result = await geocoder(fetch).batch.geocode([address, "zqxvwkpt"]);
    expect(result.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(result.items[1]!.error?.message).toBe("mapbox sent no answer for this query.");
  });

  it("reverse geocodes through the batch endpoint", async () => {
    const slot = fixture("geocoding-batch").batch[2];
    const fetch = fakeFetch({ body: { batch: [slot] } });
    const point = { lat: 44.312747, lon: -72.641827 };
    const result = await geocoder(fetch).batch.reverse([{ ...point, id: "r" }], {
      types: ["address"],
      language: "en",
    });
    expect(sent(fetch)).toMatchObject({
      method: "POST",
      url: `${API}/search/geocode/v6/batch?access_token=tok`,
      body: [{ longitude: -72.641827, latitude: 44.312747, language: "en", types: "address" }],
    });
    expect(result).toMatchObject({
      operation: "batch.reverse",
      mode: "native",
      summary: { total: 1, succeeded: 1, failed: 0 },
      unavailable: ["confidence"],
    });
    const place = result.items[0]!.results[0]!;
    expect(result.items[0]!.id).toBe("r");
    expect(place.name).toBe("27 Orchard Wynd");
    expect(place.distance).toBe(Math.round(distance(point, place.location!) * 100) / 100);
  });
});

describe("errors", () => {
  it("maps Mapbox's error body to a GeocoderError", async () => {
    const body = fixture("error");
    const fetch = fakeFetch({ status: 401, body });
    const error = await geocoder(fetch)
      .geocode("x")
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(GeocoderError);
    expect(error).toMatchObject({
      code: "unauthenticated",
      message: "The access token on this request is not valid",
      status: 401,
      provider: "mapbox",
      operation: "geocode",
      body,
    });
    const cause = (error as GeocoderError).cause;
    expect(cause).toBeInstanceOf(AuthenticationError);
    expect(cause).toMatchObject({
      message: "The access token on this request is not valid",
      status: 401,
    });
  });

  it("reads a 422 as an invalid request and a 429 as rate limited", async () => {
    const invalid = fakeFetch({
      status: 422,
      body: {
        message: "A reverse limit needs exactly one type",
      },
    });
    await expect(geocoder(invalid).reverse({ lat: 1, lon: 2 })).rejects.toMatchObject({
      code: "invalid_request",
      message: "A reverse limit needs exactly one type",
    });
    const limited = fakeFetch({ status: 429, body: { message: "Rate limit exceeded" } });
    await expect(geocoder(limited).places("x", { maxRetries: 0 })).rejects.toMatchObject({
      code: "rate_limited",
      message: "Rate limit exceeded",
      retryable: true,
    });
  });
});

describe("native", () => {
  it("sends any Mapbox request with the token applied", async () => {
    const body = { listItems: [], version: "25" };
    const fetch = fakeFetch({ body });
    const geo = geocoder(fetch);
    const answer = await geo.native.request<typeof body>({
      path: "/search/searchbox/v1/list/category",
      query: { language: "en" },
    });
    expect(answer).toEqual(body);
    expect(sent(fetch)).toMatchObject({
      method: "GET",
      url: `${API}/search/searchbox/v1/list/category?language=en&access_token=tok`,
    });
  });

  it("honours a base URL override", async () => {
    const fetch = fakeFetch({ body: fixture("geocoding-forward") });
    const geo = new Geocoder({
      adapter: mapbox({ accessToken: "tok", baseUrl: "http://proxy.test/mapbox/", fetch }),
    });
    await geo.geocode("x");
    expect(sent(fetch).url).toBe(
      "http://proxy.test/mapbox/search/geocode/v6/forward?q=x&autocomplete=false&access_token=tok",
    );
  });
});

const token = process.env.MAPBOX_ACCESS_TOKEN;

describe("storing answers", () => {
  // Mapbox answers are for temporary use unless a call is sent with `permanent=true`.
  // Source: https://docs.mapbox.com/api/search/geocoding/#storing-geocoding-results.
  it("asks for temporary answers by default, and lets a cache keep none", async () => {
    const fetch = fakeFetch({ body: fixture("geocoding-forward") });
    const geo = geocoder(fetch);
    await geo.geocode("418 Tannery Row");
    expect(sent(fetch).url).not.toContain("permanent");
    expect(geo.capabilities.cache).toEqual({ maxTtl: 0 });
    for (const operation of ["geocode", "reverse", "autocomplete", "places", "lookup"] as const)
      expect(geo.capabilities[operation]?.cache).toBeUndefined();
  });

  it("asks for permanent answers when told to, and lets a cache keep those alone", async () => {
    const fetch = fakeFetch(
      { body: fixture("geocoding-forward") },
      { body: fixture("geocoding-forward") },
      { body: fixture("geocoding-batch") },
      { body: fixture("searchbox-forward") },
    );
    const geo = new Geocoder({
      adapter: mapbox({ accessToken: "tok", fetch, permanent: true, logLevel: "off" }),
    });
    await geo.geocode("418 Tannery Row");
    await geo.reverse({ lat: 44.3, lon: -72.6 });
    await geo.batch.geocode(["418 Tannery Row"]);
    await geo.places("coffee");
    expect(new URL(sent(fetch, 0).url).searchParams.get("permanent")).toBe("true");
    expect(new URL(sent(fetch, 1).url).searchParams.get("permanent")).toBe("true");
    expect(sent(fetch, 2).url).toBe(
      `${API}/search/geocode/v6/batch?permanent=true&access_token=tok`,
    );
    // Place search is for temporary use whatever the option says.
    expect(sent(fetch, 3).url).not.toContain("permanent");
    expect(geo.capabilities.geocode?.cache).toEqual({ maxTtl: Infinity });
    expect(geo.capabilities.reverse?.cache).toEqual({ maxTtl: Infinity });
    expect(geo.capabilities.cache).toEqual({ maxTtl: 0 });
    for (const operation of ["autocomplete", "places", "lookup"] as const)
      expect(geo.capabilities[operation]?.cache).toBeUndefined();
  });
});

describe.skipIf(!token)("live", () => {
  const geo = new Geocoder({ adapter: mapbox({ accessToken: token ?? "" }) });
  const shape = {
    id: expect.any(String),
    type: expect.any(String),
    name: expect.any(String),
    label: expect.any(String),
    address: expect.any(Object),
  };

  it("geocodes and reverse geocodes", async () => {
    const forward = await geo.geocode("111 Wellington Street, Ottawa, ON", { limit: 1 });
    expect(forward.results[0]).toMatchObject({ ...shape, location: expect.any(Object) });
    const reverse = await geo.reverse({ lat: 45.4236, lon: -75.7009 });
    expect(reverse.results[0]).toMatchObject({ ...shape, distance: expect.any(Number) });
  });

  it("suggests, then resolves a suggestion", async () => {
    const session = crypto.randomUUID();
    const suggested = await geo.autocomplete("Sydney Opera House", { session, countries: ["AU"] });
    const first = suggested.results[0]!;
    expect(first).toMatchObject({ ...shape, location: null });
    const resolved = await geo.lookup(first.id!, { session });
    expect(resolved.results[0]).toMatchObject({ ...shape, location: expect.any(Object) });
  });

  it("searches places and answers nothing for an unknown id", async () => {
    const found = await geo.places("coffee", { focus: { lat: 40.7, lon: -74 }, limit: 3 });
    expect(found.results[0]).toMatchObject(shape);
    expect((await geo.lookup("not-a-mapbox-id")).results).toEqual([]);
  });

  it("runs both batches", async () => {
    const forward = await geo.batch.geocode(["111 Wellington Street, Ottawa, ON"]);
    expect(forward.mode).toBe("native");
    expect(forward.items[0]!.results[0]).toMatchObject(shape);
    const reverse = await geo.batch.reverse([{ lat: 45.4236, lon: -75.7009 }]);
    expect(reverse.items[0]!.results[0]).toMatchObject(shape);
  });
});
