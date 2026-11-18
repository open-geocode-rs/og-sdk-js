import { describe, expect, it } from "vitest";
import { google } from "../../client/src/google.ts";
import { here } from "../../client/src/here.ts";
import { createClient } from "../../client/src/index.ts";
import { mapbox } from "../../client/src/mapbox.ts";
import { precisely } from "../../client/src/precisely.ts";
import { bodyOf, fakeFetch, headersOf, urlOf } from "../../client/test/helpers.ts";
import { googleSource, hereSource, mapboxSource, ogSource, preciselySource } from "../src/index.ts";

const { signal } = new AbortController();
const baseUrl = "http://og.test";

describe("ogSource", () => {
  it("suggests from the og client, with coordinates and og's own feature", async () => {
    const feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.42, 43.73] },
      properties: { id: "osm:node:1", label: "2 Avenue de Monte-Carlo, Monaco" },
    };
    const fetch = fakeFetch({ body: { type: "FeatureCollection", features: [feature] } });
    const source = ogSource(createClient({ baseUrl, fetch }), { limit: 3, country: "MC" });
    const items = await source.getItems("2 Av", { signal });
    expect(urlOf(fetch).href).toBe("http://og.test/autocomplete?limit=3&country=MC&q=2+Av");
    expect(items).toEqual([
      {
        id: "osm:node:1",
        label: "2 Avenue de Monte-Carlo, Monaco",
        location: { lat: 43.73, lon: 7.42 },
        raw: feature,
      },
    ]);
    expect(source.getItemLabel(items[0]!)).toBe("2 Avenue de Monte-Carlo, Monaco");
    expect(await source.resolve(items[0]!)).toBe(items[0]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // The raw feature keeps og's own type.
    expect(items[0]!.raw.properties.layer).toBeUndefined();
  });
});

describe("googleSource", () => {
  it("keeps one session per search and ends it with the place lookup", async () => {
    const fetch = fakeFetch(
      {
        body: { suggestions: [{ placePrediction: { placeId: "abc", text: { text: "Casino" } } }] },
      },
      { body: { suggestions: [{ queryPrediction: { text: { text: "casino near me" } } }] } },
      { body: { id: "abc", location: { latitude: 43.74, longitude: 7.43 } } },
      { body: {} },
    );
    const source = googleSource(google({ baseUrl, fetch }), { includedRegionCodes: ["mc"] });
    const [first] = await source.getItems("cas", { signal });
    const [query] = await source.getItems("casi", { signal });
    expect(first).toMatchObject({ id: "abc", label: "Casino", location: null });
    expect(query).toMatchObject({ id: null, label: "casino near me" });
    const one = bodyOf(fetch, 0) as { sessionToken: string; input: string };
    expect(one).toMatchObject({ input: "cas", includedRegionCodes: ["mc"] });
    expect((bodyOf(fetch, 1) as typeof one).sessionToken).toBe(one.sessionToken);

    const resolved = await source.resolve(first!);
    expect(resolved.location).toEqual({ lat: 43.74, lon: 7.43 });
    expect(resolved.place?.id).toBe("abc");
    const lookup = urlOf(fetch, 2);
    expect(lookup.pathname).toBe("/compat/google/v1/places/abc");
    expect(lookup.searchParams.get("sessionToken")).toBe(one.sessionToken);
    expect(headersOf(fetch, 2)["x-goog-fieldmask"]).toBe(
      "id,location,formattedAddress,displayName",
    );

    await source.getItems("mus", { signal });
    expect((bodyOf(fetch, 3) as typeof one).sessionToken).not.toBe(one.sessionToken);
  });
});

describe("mapboxSource", () => {
  it("suggests with searchbox.suggest and resolves with searchbox.retrieve", async () => {
    const fetch = fakeFetch(
      {
        body: {
          suggestions: [
            { mapbox_id: "m1", name: "Casino", place_formatted: "Monaco" },
            { mapbox_id: "m2", name: "2 Avenue X", full_address: "2 Avenue X, Monaco" },
            { mapbox_id: "m3", name: "Monaco" },
          ],
        },
      },
      {
        body: {
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "Point", coordinates: [7.43, 43.74] } }],
        },
      },
    );
    const source = mapboxSource(mapbox({ baseUrl, fetch }), { limit: 3 });
    const items = await source.getItems("cas", { signal });
    expect(items.map((item) => item.label)).toEqual([
      "Casino, Monaco",
      "2 Avenue X, Monaco",
      "Monaco",
    ]);
    const session = urlOf(fetch).searchParams.get("session_token");
    expect(urlOf(fetch).searchParams.get("limit")).toBe("3");
    const resolved = await source.resolve(items[0]!);
    expect(resolved.location).toEqual({ lat: 43.74, lon: 7.43 });
    expect(urlOf(fetch, 1).pathname).toBe("/compat/mapbox/search/searchbox/v1/retrieve/m1");
    expect(urlOf(fetch, 1).searchParams.get("session_token")).toBe(session);
  });
});

describe("hereSource", () => {
  it("suggests with autocomplete and resolves with lookup", async () => {
    const fetch = fakeFetch(
      {
        body: {
          items: [
            { id: "here:1", title: "Avenue X", address: { label: "Avenue X, Monaco" } },
            { id: "here:2", title: "Monaco" },
          ],
        },
      },
      { body: { id: "here:1", title: "Avenue X", position: { lat: 43.74, lng: 7.43 } } },
    );
    const source = hereSource(here({ baseUrl, fetch }), { limit: 2, in: "countryCode:MCO" });
    const items = await source.getItems("Av", { signal });
    expect(urlOf(fetch).pathname).toBe("/compat/here/v1/autocomplete");
    expect(urlOf(fetch).searchParams.get("q")).toBe("Av");
    expect(urlOf(fetch).searchParams.get("limit")).toBe("2");
    expect(items.map((item) => item.label)).toEqual(["Avenue X, Monaco", "Monaco"]);
    const resolved = await source.resolve(items[0]!);
    expect(resolved.location).toEqual({ lat: 43.74, lon: 7.43 });
    expect(resolved.place?.title).toBe("Avenue X");
    expect(urlOf(fetch, 1).pathname).toBe("/compat/here/v1/lookup");
    expect(urlOf(fetch, 1).searchParams.get("id")).toBe("here:1");
  });
});

describe("preciselySource", () => {
  it("suggests addresses of one country, with the point a prediction carries", async () => {
    const fetch = fakeFetch({
      body: {
        response: {
          status: "OK",
          predictions: [
            {
              prediction: "2 Avenue X, Monaco",
              location: {
                feature: {
                  type: "Feature",
                  geometry: { type: "Point", coordinates: [7.43, 43.74] },
                },
              },
            },
            { prediction: "3 Avenue X, Monaco" },
          ],
        },
      },
    });
    const source = preciselySource(precisely({ baseUrl, fetch }), "MC", {
      preferences: { maxResults: 2 },
    });
    const items = await source.getItems("2 Av", { signal });
    expect(bodyOf(fetch)).toEqual({
      preferences: { maxResults: 2 },
      address: { addressLines: ["2 Av"], country: "MC" },
    });
    expect(items.map((item) => [item.label, item.location])).toEqual([
      ["2 Avenue X, Monaco", { lat: 43.74, lon: 7.43 }],
      ["3 Avenue X, Monaco", null],
    ]);
  });
});
