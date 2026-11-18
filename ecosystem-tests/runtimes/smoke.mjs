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

// Timeouts and cancellation against a real server and the runtime's own fetch,
// since each runtime reports a signal that fired in its own way.
const { createServer } = await import("node:http");
const open = new Set();
const server = createServer((request, response) => {
  open.add(response);
  // `/geocode` is never answered, and anything else is.
  if (!request.url.startsWith("/geocode")) response.end(JSON.stringify(collection));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const real = new Geocoder({
  adapter: og({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    maxRetries: 0,
    logLevel: "off",
  }),
});
try {
  const answered = await real.places("x");
  check(answered.results.length === 1, "the real server did not answer");

  const slow = await real.geocode("x", { timeout: 150 }).catch((thrown) => thrown);
  check(slow instanceof GeocoderError && slow.code === "timeout", `a timeout read as ${slow.code}`);
  check(
    slow.cause?.cause?.name === "TimeoutError",
    `a timeout's cause is ${slow.cause?.cause?.name}`,
  );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const stopped = await real.geocode("x", { signal: controller.signal }).catch((thrown) => thrown);
  check(
    stopped instanceof GeocoderError && stopped.code === "aborted",
    `an abort read as ${stopped.code}`,
  );
  check(
    stopped.cause?.cause?.name === "AbortError",
    `an abort's cause is ${stopped.cause?.cause?.name}`,
  );

  const own = await real
    .geocode("x", { signal: AbortSignal.timeout(100) })
    .catch((thrown) => thrown);
  check(
    own instanceof GeocoderError && own.code === "timeout",
    `a caller's timeout read as ${own.code}`,
  );

  // The caller aborts and the timeout fires close together, and the first to fire decides.
  const racing = new AbortController();
  setTimeout(() => racing.abort(), 50);
  const raced = await real
    .geocode("x", { signal: racing.signal, timeout: 400 })
    .catch((thrown) => thrown);
  check(raced.code === "aborted", `an abort before the timeout read as ${raced.code}`);
} finally {
  for (const response of open) response.destroy();
  await new Promise((resolve) => server.close(resolve));
}

console.log("smoke ok");
