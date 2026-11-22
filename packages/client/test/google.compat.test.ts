/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { google } from "../src/google.ts";

const OG_URL = process.env["OG_URL"];

/** The address the Monaco test Pack is asked for, and where it is. */
const ADDRESS = "2 Avenue de Monte-Carlo";
const POINT = { latitude: 43.7377547, longitude: 7.4270688 };

/** Live calls against og's `/compat/google`, with the Monaco test Pack loaded. */
describe.runIf(OG_URL)("google client against og", () => {
  // The key shows that a client pointed at og works with one set, and og never needs it.
  const client = google({ baseUrl: OG_URL, apiKey: "unused", logLevel: "off" });

  it("points at og", () => {
    expect(client.shape).toBe("google");
    expect(client.server).toBe("og");
  });

  it("places.searchText finds the casino, and places.get reads it back by its name", async () => {
    const outcome = await client.places
      .searchText({
        textQuery: "casino",
        pageSize: 5,
        languageCode: "en",
        fieldMask: [
          "places.name",
          "places.id",
          "places.displayName",
          "places.location",
          "places.types",
        ],
      })
      .withResponse();
    expect(outcome.server).toBe("og");
    expect(outcome.cache).toEqual({ maxTtl: Infinity });
    expect(outcome.requestId).toEqual(expect.any(String));
    const places = outcome.data.places ?? [];
    expect(places.length).toBeGreaterThan(0);
    expect(places.length).toBeLessThanOrEqual(5);
    // The mask is honoured, so nothing but the fields asked for comes back.
    for (const place of places)
      expect(["name", "id", "displayName", "location", "types"]).toEqual(
        expect.arrayContaining(Object.keys(place)),
      );
    const casino = places.find((place) => place.displayName?.text === "Casino de Monte Carlo");
    expect(casino).toBeDefined();
    expect(casino?.name).toBe(`places/${casino?.id}`);
    expect(casino?.location?.latitude).toBeCloseTo(43.7391605, 5);
    expect(casino?.location?.longitude).toBeCloseTo(7.428023, 5);
    expect(casino?.types).toContain("point_of_interest");

    const place = await client.places.get({
      name: casino!.name!,
      fieldMask: ["id", "displayName", "location", "formattedAddress", "addressComponents"],
      languageCode: "en",
    });
    expect(place.id).toBe(casino?.id);
    expect(place.displayName?.text).toBe("Casino de Monte Carlo");
    expect(place.location).toEqual(casino?.location);
    expect(place.formattedAddress).toContain("Monaco");
    expect(place.addressComponents?.some((part) => part.types?.includes("country"))).toBe(true);
    expect(place).not.toHaveProperty("types");
  });

  it("places.searchText keeps to a rectangle", async () => {
    const low = { latitude: 43.738, longitude: 7.42 };
    const high = { latitude: 43.742, longitude: 7.43 };
    const { places = [] } = await client.places.searchText({
      textQuery: "casino",
      fieldMask: ["places.id", "places.location"],
      locationRestriction: { rectangle: { low, high } },
    });
    expect(places.length).toBeGreaterThan(0);
    for (const place of places) {
      expect(place.location?.latitude).toBeGreaterThanOrEqual(low.latitude);
      expect(place.location?.latitude).toBeLessThanOrEqual(high.latitude);
      expect(place.location?.longitude).toBeGreaterThanOrEqual(low.longitude);
      expect(place.location?.longitude).toBeLessThanOrEqual(high.longitude);
    }
  });

  it("places.autocomplete suggests the address, and its place ID feeds places.get and geocode.place", async () => {
    const { suggestions = [] } = await client.places.autocomplete({
      input: "2 Avenue de Monte",
      origin: { latitude: 43.73, longitude: 7.42 },
      sessionToken: "compat-session",
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    const first = suggestions[0]?.placePrediction;
    expect(first?.structuredFormat?.mainText?.text).toBe(ADDRESS);
    expect(first?.text?.text).toContain(ADDRESS);
    expect(first?.place).toBe(`places/${first?.placeId}`);
    expect(first?.types).toContain("street_address");
    // The typed text is matched from the start, and a start of 0 is left out as proto3 JSON does.
    expect(first?.text?.matches?.[0]).toEqual({ endOffset: "2 Avenue de Monte".length });
    expect(first?.distanceMeters).toBeGreaterThan(500);
    expect(first?.distanceMeters).toBeLessThan(2000);

    const place = await client.places.get({
      name: first!.place!,
      fieldMask: ["id", "location", "formattedAddress"],
      sessionToken: "compat-session",
    });
    expect(place.id).toBe(first?.placeId);
    expect(place.location?.latitude).toBeCloseTo(POINT.latitude, 6);
    expect(place.location?.longitude).toBeCloseTo(POINT.longitude, 6);
    expect(place.formattedAddress).toContain(ADDRESS);

    const result = await client.geocode.place({ place: first!.place! });
    expect(result.placeId).toBe(first?.placeId);
    expect(result.place).toBe(`places/${first?.placeId}`);
    expect(result.location).toEqual(POINT);
    expect(result.granularity).toBe("ROOFTOP");
    expect(result.formattedAddress).toContain(ADDRESS);
  });

  it("places.autocomplete honours a field mask", async () => {
    const { suggestions = [] } = await client.places.autocomplete({
      input: "casino de",
      fieldMask: ["suggestions.placePrediction.placeId", "suggestions.placePrediction.text.text"],
    });
    expect(suggestions.length).toBeGreaterThan(0);
    const first = suggestions[0]?.placePrediction;
    expect(new Set(Object.keys(first ?? {}))).toEqual(new Set(["placeId", "text"]));
    expect(first?.text).toEqual({ text: expect.stringContaining("Casino") });
  });

  it("geocode.address finds an address given as one text", async () => {
    const { results = [] } = await client.geocode.address({
      addressQuery: `${ADDRESS}, Monaco`,
      regionCode: "MC",
    });
    const first = results[0];
    expect(first?.location).toEqual(POINT);
    expect(first?.granularity).toBe("ROOFTOP");
    expect(first?.formattedAddress).toContain(ADDRESS);
    expect(first?.types).toContain("street_address");
    expect(first?.postalAddress).toMatchObject({
      addressLines: [ADDRESS],
      locality: "Monaco",
      postalCode: "98000",
      regionCode: "MC",
    });
    const part = (type: string): string | undefined =>
      first?.addressComponents?.find((component) => component.types?.includes(type))?.longText;
    expect(part("street_number")).toBe("2");
    expect(part("route")).toBe("Avenue de Monte-Carlo");
    expect(part("postal_code")).toBe("98000");
    expect(first?.place).toBe(`places/${first?.placeId}`);
  });

  it("geocode.address finds an address given in parts, and honours a field mask", async () => {
    const { results = [] } = await client.geocode.address({
      address: { addressLines: [ADDRESS], locality: "Monaco", regionCode: "MC" },
      fieldMask: ["results.formattedAddress", "results.location"],
    });
    expect(results[0]).toEqual({
      formattedAddress: expect.stringContaining(ADDRESS),
      location: POINT,
    });
  });

  it("geocode.address answers no results for an address nobody has", async () => {
    await expect(client.geocode.address({ addressQuery: "zzzzqqqq" })).resolves.toEqual({});
  });

  it("geocode.location finds the address at a point, given either way", async () => {
    const inPath = await client.geocode.location({
      locationQuery: `${POINT.latitude},${POINT.longitude}`,
    });
    const first = inPath.results?.[0];
    expect(first?.formattedAddress).toContain(ADDRESS);
    expect(first?.location).toEqual(POINT);
    expect(first?.granularity).toBe("ROOFTOP");
    // The address comes first, then the areas that hold it.
    expect(inPath.results?.length).toBeGreaterThan(1);
    expect(inPath.results?.some((result) => result.types?.includes("country"))).toBe(true);

    const inParts = await client.geocode.location({ location: POINT });
    expect(inParts).toEqual(inPath);
  });

  it("geocode.location filters by types and by granularity", async () => {
    const areas = await client.geocode.location({
      location: POINT,
      types: ["locality", "country"],
      fieldMask: ["results.formattedAddress", "results.types"],
    });
    expect(areas.results?.length).toBeGreaterThan(0);
    for (const result of areas.results ?? []) {
      expect(new Set(Object.keys(result))).toEqual(new Set(["formattedAddress", "types"]));
      expect(result.types?.some((type) => type === "locality" || type === "country")).toBe(true);
    }

    const exact = await client.geocode.location({
      locationQuery: `${POINT.latitude},${POINT.longitude}`,
      granularity: ["ROOFTOP"],
      types: ["street_address"],
    });
    expect(exact.results?.length).toBeGreaterThan(0);
    for (const result of exact.results ?? []) {
      expect(result.granularity).toBe("ROOFTOP");
      expect(result.types).toContain("street_address");
    }
  });

  it("geocode.place reads the place geocode.address found", async () => {
    const { results = [] } = await client.geocode.address({ addressQuery: ADDRESS });
    const placeId = results[0]?.placeId;
    expect(placeId).toMatch(/^og_[A-Za-z0-9_-]+$/);
    const result = await client.geocode.place({
      place: results[0]!.place!,
      fieldMask: ["placeId", "location", "formattedAddress"],
    });
    expect(result).toEqual({
      placeId,
      location: POINT,
      formattedAddress: results[0]?.formattedAddress,
    });
  });

  it("places.searchNearby finds the places of a type inside a circle", async () => {
    const circle = { circle: { center: POINT, radius: 1000 } };
    const { places = [] } = await client.places.searchNearby({
      fieldMask: ["places.id", "places.primaryType", "places.types", "places.location"],
      includedTypes: ["pharmacy"],
      maxResultCount: 3,
      locationRestriction: circle,
    });
    expect(places.length).toBeGreaterThanOrEqual(1);
    expect(places.length).toBeLessThanOrEqual(3);
    for (const place of places) {
      expect(place.id).toEqual(expect.any(String));
      expect(place.primaryType).toBe("pharmacy");
      expect(place.types).toContain("establishment");
      expect(Math.abs(place.location!.latitude! - POINT.latitude)).toBeLessThan(0.01);
    }

    const none = await client.places.searchNearby({
      fieldMask: ["places.id"],
      includedTypes: ["pharmacy"],
      excludedTypes: ["establishment"],
      locationRestriction: circle,
    });
    expect(none).toEqual({});
  });

  it("geocode.destinations finds the address by text, in parts, at a point and by its place", async () => {
    const byText = await client.geocode.destinations({ addressQuery: { addressQuery: ADDRESS } });
    const primary = byText.destinations?.[0]?.primary;
    expect(primary?.displayName?.text).toBe(ADDRESS);
    expect(primary?.location).toEqual(POINT);
    expect(primary?.place).toBe(`places/${primary?.placeId}`);
    expect(primary?.primaryType).toBe("street_address");
    expect(primary?.postalAddress?.addressLines).toEqual([ADDRESS]);

    const byParts = await client.geocode.destinations({
      addressQuery: { address: { addressLines: [ADDRESS], locality: "Monaco", regionCode: "MC" } },
      fieldMask: ["destinations.primary.placeId"],
    });
    expect(byParts).toEqual({ destinations: [{ primary: { placeId: primary?.placeId } }] });

    const atPoint = await client.geocode.destinations({
      locationQuery: { location: POINT },
      fieldMask: ["destinations.primary.placeId"],
    });
    expect(atPoint).toEqual(byParts);

    // A town is no destination.
    await expect(
      client.geocode.destinations({ addressQuery: { addressQuery: "Monaco" } }),
    ).resolves.toEqual({});
  });

  it("geocode.destinations states the entrances of a place, the main one preferred", async () => {
    const { places = [] } = await client.places.searchText({
      textQuery: "Musée Océanographique",
      fieldMask: ["places.name", "places.displayName"],
    });
    const museum = places.find((place) => place.displayName?.text === "Musée Océanographique");
    expect(museum?.name).toEqual(expect.any(String));
    const { destinations = [] } = await client.geocode.destinations({
      place: museum!.name!,
      fieldMask: ["destinations.primary.place", "destinations.entrances"],
    });
    expect(destinations).toHaveLength(1);
    const entrances = destinations[0]?.entrances ?? [];
    expect(entrances.length).toBeGreaterThan(0);
    for (const entrance of entrances) {
      expect(entrance.place).toBe(museum?.name);
      expect(Math.abs(entrance.location!.latitude! - 43.7308)).toBeLessThan(0.01);
    }
    expect(entrances.filter((entrance) => entrance.tags?.includes("PREFERRED"))).toHaveLength(1);
  });

  it("places.getPhotoMedia finds no photo, since og holds none", async () => {
    const { places = [] } = await client.places.searchText({
      textQuery: "casino",
      fieldMask: ["places.name"],
    });
    const name = places[0]?.name;
    expect(name).toEqual(expect.any(String));
    await expect(
      client.places.getPhotoMedia({ name: `${name}/photos/any/media`, maxWidthPx: 400 }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
      body: { error: { status: "INVALID_ARGUMENT" } },
    });
    await expect(
      client.places.getPhotoMedia({ name: "places/nope/photos/any/media", maxHeightPx: 400 }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("maps og's error answers, which keep Google's envelope", async () => {
    await expect(
      client.places.get({ name: "places/nope", fieldMask: ["id"] }),
    ).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      provider: "og",
      message: "Place 'places/nope' was not found.",
      body: { error: { status: "NOT_FOUND" } },
    });
    await expect(client.geocode.place({ place: "places/nope" })).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(
      client.places.searchText({ textQuery: "", fieldMask: ["places.id"] }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
      message: "textQuery is required",
      body: { error: { status: "INVALID_ARGUMENT" } },
    });
    await expect(client.places.autocomplete({ input: "" })).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    await expect(client.geocode.location({ locationQuery: "north,east" })).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });
});
