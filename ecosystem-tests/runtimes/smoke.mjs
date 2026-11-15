// Imports the built packages by name and runs every adapter against a fake fetch.
// It runs under Node, Bun and Deno to prove the packages need no runtime-specific APIs.
import { createAutocomplete, geocoderSource } from "@open-geocode/autocomplete-core";
import { Geocoder, GeocoderError } from "@open-geocode/client";
import { google } from "@open-geocode/client/google";
import { here } from "@open-geocode/client/here";
import { mapbox } from "@open-geocode/client/mapbox";
import { createClient, og } from "@open-geocode/client/og";
import { cache, compare, failover } from "@open-geocode/client/plugins";
import { precisely } from "@open-geocode/client/precisely";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A fetch that answers every request with `body` and remembers the URLs asked for. */
function fake(body, status = 200) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req-1" },
    });
  };
  return { fetch, urls };
}

const feature = {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-75.694, 45.444] },
  properties: {
    id: "osm:node:1",
    layer: "address",
    accuracy: "rooftop",
    name: "24 Sussex Drive",
    label: "24 Sussex Drive, Ottawa",
    source: { dataset: "osm" },
    context: { country: { id: "osm:relation:2", name: "Canada", code: "CA" } },
  },
};
const collection = {
  type: "FeatureCollection",
  geocoding: { version: "1", query: "24 Sussex Drive", attribution: [] },
  features: [feature],
};

// The og adapter, with every plugin around it.
const local = fake(collection);
const reports = [];
const geo = new Geocoder({
  adapter: og({ baseUrl: "http://og.test", fetch: local.fetch }),
  plugins: [
    cache(),
    failover({ to: og({ baseUrl: "http://fallback.test", fetch: local.fetch }) }),
    compare({
      with: og({ baseUrl: "http://candidate.test", fetch: local.fetch }),
      onReport: (report) => reports.push(report),
      wait: true,
    }),
  ],
});
const first = await geo.geocode("24 Sussex Drive", { include: ["context"] }).withResponse();
check(first.requestId === "req-1", "request id is missing");
check(first.data.results[0].address.countryCode === "CA", "og result was not normalised");
check(first.data.results[0].context.country.code === "CA", "include was not honoured");
check(
  local.urls[0] === "http://og.test/geocode?q=24+Sussex+Drive",
  `unexpected URL ${local.urls[0]}`,
);
check(reports.length === 1 && reports[0].comparison.agree, "compare did not report");
const second = await geo.geocode("24 Sussex Drive", { include: ["context"] }).withResponse();
check(second.response === undefined, "the second call was not served from the cache");

// Every vendor adapter answers an empty result in the same shape.
const vendors = [
  [google({ apiKey: "key", fetch: fake({ results: [] }).fetch }), "google"],
  [
    mapbox({
      accessToken: "token",
      fetch: fake({ type: "FeatureCollection", features: [] }).fetch,
    }),
    "mapbox",
  ],
  [here({ apiKey: "key", fetch: fake({ items: [] }).fetch }), "here"],
  [
    precisely({
      apiKey: "key",
      apiSecret: "secret",
      defaultCountry: "US",
      fetch: fake({ responses: [{ status: "OK", results: [] }] }).fetch,
    }),
    "precisely",
  ],
];
for (const [adapter, name] of vendors) {
  const result = await new Geocoder({ adapter }).geocode("10 King St W, Toronto");
  check(result.provider === name, `${name} did not answer as itself`);
  check(
    Array.isArray(result.results) && result.results.length === 0,
    `${name} result is malformed`,
  );
  check(Array.isArray(result.unavailable), `${name} lists no unavailable fields`);
}

// One error class, whatever the provider.
const failing = new Geocoder({
  adapter: mapbox({
    accessToken: "token",
    fetch: fake({ message: "Not Authorized" }, 401).fetch,
    logLevel: "off",
  }),
});
const error = await failing.geocode("x").catch((thrown) => thrown);
check(
  error instanceof GeocoderError && error.code === "unauthenticated",
  "errors are not normalised",
);

// og's native client and the headless autocomplete.
const native = await createClient({ baseUrl: "http://og.test", fetch: local.fetch }).geocode({
  q: "x",
});
check(native.features.length === 1, "the native client failed");
const source = geocoderSource(geo, { limit: 5 });
const autocomplete = createAutocomplete({ ...source, debounce: 0 });
autocomplete.onInput("24 Sussex");
await new Promise((resolve) => setTimeout(resolve, 20));
check(autocomplete.getState().items.length === 1, "the autocomplete got no suggestions");
autocomplete.destroy();

console.log("smoke ok");
