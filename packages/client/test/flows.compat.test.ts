/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { GeocoderError } from "../src/errors.ts";
import { google } from "../src/google.ts";
import { here } from "../src/here.ts";
import { mapbox } from "../src/mapbox.ts";
import { precisely } from "../src/precisely.ts";

/**
 * og serving a Rhode Island Pack calibrated with `geocode calibrate`. The Pack has regions,
 * US addresses and towns that share a word ("Providence", "East Providence"), which the
 * Monaco Pack of the vendor suites has none of.
 */
const OG_RI_URL = process.env["OG_RI_URL"];

/** An address of the Pack, and the street line and town it is written with. */
const STREET_LINE = "25 Dorrance Street";
const TOWN = "Providence";
const LABEL = "25 Dorrance Street, Providence, RI, 02903";
const AT = { lat: 41.8240167, lng: -71.4125419 };

const refused = (promise: PromiseLike<unknown>): Promise<GeocoderError> =>
  Promise.resolve(promise).then(
    () => {
      throw new Error("The call was not refused.");
    },
    (error: GeocoderError) => error,
  );

// The flows a company runs on its own data, one per vendor, end to end against og.
describe.runIf(OG_RI_URL)("company flows against og on a Rhode Island Pack", () => {
  describe("google", () => {
    const client = google({ baseUrl: OG_RI_URL, apiKey: "unused", logLevel: "off" });

    it("an address picked from autocomplete opens as the same address", async () => {
      const { suggestions } = await client.places.autocomplete({
        input: `${STREET_LINE}, ${TOWN}`,
      });
      const picked = suggestions?.find((suggestion) => suggestion.placePrediction)?.placePrediction;
      expect(picked?.text?.text).toContain(STREET_LINE);
      const place = await client.places.get({
        name: `places/${picked!.placeId}`,
        fieldMask: ["formattedAddress", "location"],
      });
      expect(place.formattedAddress).toContain(STREET_LINE);
      expect(place.location?.latitude).toBeCloseTo(AT.lat, 3);
    });

    it("a search for an area answers the area first, with the box it covers", async () => {
      const { places } = await client.places.searchText({
        textQuery: "Rhode Island",
        fieldMask: ["places.displayName", "places.types", "places.viewport"],
      });
      const region = places?.[0];
      expect(region?.displayName?.text).toBe("Rhode Island");
      expect(region?.types).toEqual(["administrative_area_level_1", "political"]);
      expect(region?.viewport?.low?.latitude).toBeLessThan(region?.viewport?.high?.latitude ?? 0);
      const towns = await client.places.searchText({
        textQuery: TOWN,
        fieldMask: ["places.types"],
      });
      expect(towns.places?.[0]?.types).toEqual(["locality", "political"]);
    });

    it("a type filter keeps only places of the type", async () => {
      const { places } = await client.places.searchText({
        textQuery: "Citizens Bank",
        includedType: "bank",
        strictTypeFiltering: true,
        fieldMask: ["places.types"],
      });
      expect(places?.length).toBeGreaterThan(0);
      for (const place of places ?? []) expect(place.types).toContain("bank");
    });
  });

  describe("mapbox", () => {
    const client = mapbox({ baseUrl: OG_RI_URL, accessToken: "pk.never-sent", logLevel: "off" });

    it("a suggested address retrieves as the same address", async () => {
      const { suggestions } = await client.searchbox.suggest({
        q: `${STREET_LINE}, ${TOWN}`,
        session_token: "flow",
      });
      const address = suggestions.find((suggestion) => suggestion.feature_type === "address");
      expect(address?.full_address).toContain(STREET_LINE);
      const { features } = await client.searchbox.retrieve({
        id: address!.mapbox_id,
        session_token: "flow",
      });
      expect(features[0]?.properties.full_address).toBe(address?.full_address);
    });

    it("a match code says the town of a longer name is not matched", async () => {
      const { features } = await client.geocoding.forward({
        q: `${STREET_LINE}, ${TOWN}`,
        limit: 1,
      });
      expect(features[0]?.properties.match_code).toMatchObject({
        address_number: "matched",
        street: "matched",
        place: "matched",
      });
      const east = await client.geocoding.forward({ q: "1 Main Street, Providence", limit: 5 });
      const addresses = east.features.filter(
        (feature) => feature.properties.feature_type === "address",
      );
      expect(addresses.length).toBeGreaterThan(0);
      for (const feature of addresses) {
        if (feature.properties.place_formatted?.startsWith("East Providence")) {
          expect(feature.properties.match_code?.place).toBe("unmatched");
        }
      }
    });

    it("a region alone answers reverse, and a town answers forward search", async () => {
      const regions = await client.geocoding.reverse({
        longitude: AT.lng,
        latitude: AT.lat,
        types: ["region"],
      });
      expect(regions.features.map((feature) => feature.properties.name)).toEqual(["Rhode Island"]);
      const towns = await client.searchbox.forward({ q: TOWN });
      expect(towns.features[0]?.properties).toMatchObject({ feature_type: "place", name: TOWN });
    });
  });

  describe("here", () => {
    const client = here({ baseUrl: OG_RI_URL, apiKey: "unused", logLevel: "off" });

    it("a geocoded address carries its scores and looks up as itself", async () => {
      const { items } = await client.geocode({ q: `${STREET_LINE}, ${TOWN}` });
      const item = items[0]!;
      expect(item.address.label).toBe(LABEL);
      expect(item.scoring?.queryScore).toBe(1);
      expect(item.scoring?.fieldScore?.city).toBe(1);
      const found = await client.lookup({ id: item.id });
      expect(found.address.label).toBe(LABEL);
    });

    it("a town whose name holds the asked one scores its city in part", async () => {
      const { items } = await client.geocode({ q: TOWN, limit: 5 });
      const city = (title: string) => items.find((item) => item.title === title)?.scoring;
      expect(city(TOWN)?.fieldScore?.city).toBe(1);
      expect(city("East Providence")?.fieldScore?.city).toBeLessThan(1);
    });

    it("a page past what og answers is refused", async () => {
      const error = await refused(
        client.discover({ q: "school", at: `${AT.lat},${AT.lng}`, limit: 100 }),
      );
      expect(error.status).toBe(400);
    });
  });

  describe("precisely", () => {
    const client = precisely({ baseUrl: OG_RI_URL ?? "", logLevel: "off" });

    it("verify standardizes an address with a score and a match code", async () => {
      const { responses } = await client.verify({
        addresses: [{ addressLines: ["25 Dorrance St"], city: TOWN, admin1: "RI", country: "USA" }],
      });
      const result = responses[0]?.results?.[0];
      expect(result?.address?.formattedAddress).toBe(LABEL);
      expect(result?.score).toBeGreaterThan(0);
      expect(result?.customFields?.["SIMPLE_MATCH_CODE"]).toMatch(/^V4-P4S4A6T4R4Z6C4-[0-5]$/);
      const described = Object.fromEntries(
        result!.explanation!.addressMatch!.description!.map((part) => [part.label, part.matchType]),
      );
      expect(described).toMatchObject({ city: "EXACT", country: "EXACT", postalCode: "ADDED" });
      const explained = await client.explainAddressCode({
        codeType: "GlobalMatchCode",
        codes: [{ id: "c1", code: result!.customFields!["SIMPLE_MATCH_CODE"]! }],
      });
      expect(explained.responses[0]?.result?.customerInsightSummary).toMatch(
        /^Address premise verified with /,
      );
    });

    it("verify never calls another town exact", async () => {
      const { responses } = await client.verify({
        addresses: [{ addressLines: ["1 Main St"], city: TOWN, admin1: "RI", country: "USA" }],
      });
      for (const result of responses[0]?.results ?? []) {
        const city = result.explanation?.addressMatch?.description?.find(
          (part) => part.label === "city",
        );
        if (city?.matchType === "EXACT") expect(result.address?.city?.longName).toBe(TOWN);
      }
    });

    it("a country the Pack does not hold finds nothing", async () => {
      const { responses } = await client.geocode({
        addresses: [{ addressLines: ["1 Main St"], country: "FRA" }],
      });
      expect(responses[0]?.status).toBe("ZERO_RESULTS");
    });
  });
});
