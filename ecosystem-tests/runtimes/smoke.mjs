// Imports the built packages by name and runs every client against a fake fetch.
// It runs under Node, Bun and Deno to prove the packages need no runtime-specific APIs.
import { createAutocomplete, mapboxSource, ogSource } from "@open-geocode/autocomplete-core";
import { createClient, GeocoderError } from "@open-geocode/client";
import { google } from "@open-geocode/client/google";
import { here } from "@open-geocode/client/here";
import { mapbox } from "@open-geocode/client/mapbox";
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
    timezone: "America/Toronto",
    context: { country: { id: "osm:relation:2", name: "Canada", code: "CA" } },
  },
};
const collection = {
  type: "FeatureCollection",
  geocoding: { version: "1", query: "24 Sussex Drive", attribution: [] },
  features: [feature],
};

// The og client, with every plugin around it.
const local = fake(collection);
const reports = [];
const og = createClient({
  baseUrl: "http://og.test",
  fetch: local.fetch,
  plugins: [
    cache(),
    failover({ to: createClient({ baseUrl: "http://fallback.test", fetch: local.fetch }) }),
    compare({
      with: createClient({ baseUrl: "http://candidate.test", fetch: local.fetch }),
      onReport: (report) => reports.push(report),
      wait: true,
    }),
  ],
});
const first = await og.geocode({ q: "24 Sussex Drive", include: ["timezone"] }).withResponse();
check(first.requestId === "req-1", "request id is missing");
check(first.server === "og", "the answering server is not named");
check(first.data.features[0].properties.context.country.code === "CA", "og's shape was changed");
check(first.data.features[0].properties.timezone === "America/Toronto", "include was not honoured");
check(
  local.urls[0] === "http://og.test/geocode?q=24+Sussex+Drive",
  `unexpected URL ${local.urls[0]}`,
);
check(reports.length === 1 && reports[0].comparison.agree, "compare did not report");
const second = await og.geocode({ q: "24 Sussex Drive", include: ["timezone"] }).withResponse();
check(second.response === undefined, "the second call was not served from the cache");
const lean = await og.geocode({ q: "24 Sussex Drive" });
check(!("timezone" in lean.features[0].properties), "an extra came without being included");

// Every vendor client returns the server's JSON untouched, from og and from the vendor.
const vendors = [
  [
    google,
    { apiKey: "key" },
    (client) => client.geocode.address({ addressQuery: "x" }),
    "googleapis.com",
  ],
  [
    mapbox,
    { accessToken: "token" },
    (client) => client.geocoding.forward({ q: "x" }),
    "api.mapbox.com",
  ],
  [here, { apiKey: "key" }, (client) => client.geocode({ q: "x" }), "hereapi.com"],
];
for (const [create, credentials, call, host] of vendors) {
  const body = { marker: create.name, nested: { untouched: [1, 2, 3] } };
  const viaOg = fake(body);
  const onOg = create({ baseUrl: "http://og.test", ...credentials, fetch: viaOg.fetch });
  const answer = await call(onOg).withResponse();
  check(JSON.stringify(answer.data) === JSON.stringify(body), `${create.name} changed the answer`);
  check(answer.server === "og", `${create.name} did not name og as the server`);
  check(
    viaOg.urls[0].startsWith(`http://og.test/compat/${create.name}/`),
    `${create.name} asked og at ${viaOg.urls[0]}`,
  );
  check(!/key|token/.test(viaOg.urls[0]), `${create.name} sent its credential to og`);
  const direct = fake(body);
  const onVendor = create({ ...credentials, fetch: direct.fetch });
  check((await call(onVendor).withResponse()).server === create.name, `${create.name} server`);
  check(direct.urls[0].includes(host), `${create.name} asked ${direct.urls[0]}`);
}
const viaOg = fake({ responses: [] });
await precisely({ baseUrl: "http://og.test", fetch: viaOg.fetch }).geocode({
  addresses: [{ addressLines: ["x"], country: "US" }],
});
check(
  viaOg.urls.length === 1 && viaOg.urls[0] === "http://og.test/compat/precisely/v1/geocode",
  `precisely asked og at ${viaOg.urls}`,
);

// One error class, whichever client.
const failing = mapbox({
  accessToken: "token",
  fetch: fake({ message: "Not Authorized" }, 401).fetch,
  logLevel: "off",
});
const error = await failing.geocoding.forward({ q: "x" }).catch((thrown) => thrown);
check(
  error instanceof GeocoderError && error.code === "unauthenticated" && error.provider === "mapbox",
  "errors are not normalised",
);
let refused;
try {
  here({
    apiKey: "key",
    plugins: [compare({ with: here({ baseUrl: "http://og.test" }), onReport() {} })],
  });
} catch (thrown) {
  refused = thrown;
}
check(refused?.code === "unsupported", "a comparison with HERE was not refused");

// The headless autocomplete, fed by the og client and by a vendor client.
const autocomplete = createAutocomplete({ ...ogSource(og, { limit: 5 }), debounce: 0 });
autocomplete.onInput("24 Sussex");
await new Promise((resolve) => setTimeout(resolve, 20));
check(autocomplete.getState().items.length === 1, "the autocomplete got no suggestions");
autocomplete.destroy();
const suggested = await mapboxSource(
  mapbox({
    baseUrl: "http://og.test",
    fetch: fake({ suggestions: [{ mapbox_id: "a", name: "Casino", place_formatted: "Monaco" }] })
      .fetch,
  }),
).getItems("cas", { signal: new AbortController().signal });
check(suggested[0].label === "Casino, Monaco", "the mapbox source got no suggestions");

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
const real = createClient({
  baseUrl: `http://127.0.0.1:${server.address().port}`,
  maxRetries: 0,
  logLevel: "off",
});
try {
  const answered = await real.places({ q: "x" });
  check(answered.features.length === 1, "the real server did not answer");

  const slow = await real.geocode({ q: "x" }, { timeout: 150 }).catch((thrown) => thrown);
  check(slow instanceof GeocoderError && slow.code === "timeout", `a timeout read as ${slow.code}`);
  check(
    slow.cause?.cause?.name === "TimeoutError",
    `a timeout's cause is ${slow.cause?.cause?.name}`,
  );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const stopped = await real
    .geocode({ q: "x" }, { signal: controller.signal })
    .catch((thrown) => thrown);
  check(
    stopped instanceof GeocoderError && stopped.code === "aborted",
    `an abort read as ${stopped.code}`,
  );
  check(
    stopped.cause?.cause?.name === "AbortError",
    `an abort's cause is ${stopped.cause?.cause?.name}`,
  );

  const own = await real
    .geocode({ q: "x" }, { signal: AbortSignal.timeout(100) })
    .catch((thrown) => thrown);
  check(
    own instanceof GeocoderError && own.code === "timeout",
    `a caller's timeout read as ${own.code}`,
  );

  // The caller aborts and the timeout fires close together, and the first to fire decides.
  const racing = new AbortController();
  setTimeout(() => racing.abort(), 50);
  const raced = await real
    .geocode({ q: "x" }, { signal: racing.signal, timeout: 400 })
    .catch((thrown) => thrown);
  check(raced.code === "aborted", `an abort before the timeout read as ${raced.code}`);
} finally {
  for (const response of open) response.destroy();
  await new Promise((resolve) => server.close(resolve));
}

console.log("smoke ok");
