/**
 * Writes a one-file web page of the clients, built around the import table, with one tab per client.
 * The method names are read off the clients themselves, so the page fails to build when a method
 * is added or removed without its row here.
 * `bun run docs:page` writes it to `docs-preview/index.html`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { google } from "../src/google.ts";
import { here } from "../src/here.ts";
import { createClient } from "../src/index.ts";
import { mapbox } from "../src/mapbox.ts";
import { precisely } from "../src/precisely.ts";

/** A method's endpoint, and whether og serves it. Every og method is served by og. */
type Row = [endpoint: string, onOg?: false];

interface Tab {
  id: string;
  title: string;
  importPath: string;
  factory: string;
  speaks: string;
  asks: string;
  client: object;
  credentials: string;
  cache: string;
  example: string;
  rows: Record<string, Row>;
}

const baseUrl = "http://localhost:8080";

const TABS: Tab[] = [
  {
    id: "og",
    title: "og",
    importPath: "@open-geocode/client",
    factory: "createClient()",
    speaks: "og's own API",
    asks: "og",
    client: createClient({ baseUrl }),
    credentials: "None. `headers` carries your gateway's own auth.",
    cache: "No limit.",
    example: `import { createClient } from "@open-geocode/client";

const og = createClient({ baseUrl: "http://localhost:8080" });
const { features } = await og.geocode({
  q: "10 King St W, Toronto",
  include: ["timezone", "bbox"],
});
console.log(features[0].properties.label, features[0].geometry.coordinates);`,
    rows: {
      geocode: ["GET /geocode"],
      reverse: ["GET /reverse"],
      autocomplete: ["GET /autocomplete"],
      places: ["GET /places"],
      "batch.geocode": ["POST /geocode"],
      "batch.reverse": ["POST /reverse"],
      "batch.places": ["POST /places"],
      "jobs.create": ["POST /jobs"],
      "jobs.status": ["GET /jobs/{id}"],
      "jobs.wait": ["GET /jobs/{id}, until the job stops"],
      "jobs.results": ["GET /jobs/{id}/results"],
      "jobs.lines": ["GET /jobs/{id}/results, line by line"],
      "jobs.cancel": ["POST /jobs/{id}/cancel"],
      "jobs.delete": ["DELETE /jobs/{id}"],
    },
  },
  {
    id: "google",
    title: "Google",
    importPath: "@open-geocode/client/google",
    factory: "google()",
    speaks: "Google's API, Places v1 and Geocoding v4",
    asks: "og at /compat/google, or Google",
    client: google({ baseUrl }),
    credentials: "`apiKey`, sent as the `X-Goog-Api-Key` header.",
    cache: "30 days.",
    example: `import { google } from "@open-geocode/client/google";

const client = google({ baseUrl: "http://localhost:8080" }); // or google({ apiKey })
const { places } = await client.places.searchText({
  textQuery: "Casino de Monte-Carlo",
  fieldMask: ["places.id", "places.displayName", "places.location"],
});`,
    rows: {
      "places.searchText": ["POST /v1/places:searchText"],
      "places.autocomplete": ["POST /v1/places:autocomplete"],
      "places.get": ["GET /v1/places/{placeId}"],
      "places.searchNearby": ["POST /v1/places:searchNearby"],
      "places.getPhotoMedia": ["GET /v1/places/{placeId}/photos/{photoReference}/media"],
      "geocode.address": ["GET /v4/geocode/address"],
      "geocode.location": ["GET /v4/geocode/location"],
      "geocode.place": ["GET /v4/geocode/places/{placeId}"],
      "geocode.destinations": ["POST /v4/geocode/destinations"],
    },
  },
  {
    id: "mapbox",
    title: "Mapbox",
    importPath: "@open-geocode/client/mapbox",
    factory: "mapbox()",
    speaks: "Mapbox's API, Geocoding v6 and Search Box v1",
    asks: "og at /compat/mapbox, or Mapbox",
    client: mapbox({ baseUrl }),
    credentials: "`accessToken`, sent as the `access_token` query parameter.",
    cache: "Not at all, except a Geocoding call sent with `permanent: true`, which has no limit.",
    example: `import { mapbox } from "@open-geocode/client/mapbox";

const client = mapbox({ baseUrl: "http://localhost:8080" }); // or mapbox({ accessToken })
const { features } = await client.geocoding.forward({ q: "10 King St W, Toronto" });
console.log(features[0].properties.full_address);`,
    rows: {
      "geocoding.forward": ["GET /search/geocode/v6/forward"],
      "geocoding.reverse": ["GET /search/geocode/v6/reverse"],
      "geocoding.batch": ["POST /search/geocode/v6/batch"],
      "searchbox.suggest": ["GET /search/searchbox/v1/suggest"],
      "searchbox.retrieve": ["GET /search/searchbox/v1/retrieve/{id}"],
      "searchbox.forward": ["GET /search/searchbox/v1/forward"],
      "searchbox.reverse": ["GET /search/searchbox/v1/reverse"],
      "searchbox.category": ["GET /search/searchbox/v1/category/{id}"],
      "searchbox.listCategories": ["GET /search/searchbox/v1/list/category"],
    },
  },
  {
    id: "here",
    title: "HERE",
    importPath: "@open-geocode/client/here",
    factory: "here()",
    speaks: "HERE's API, Geocoding and Search v1 and Batch v7",
    asks: "og at /compat/here, or HERE",
    client: here({ baseUrl }),
    credentials: "`apiKey`, sent as the `apiKey` query parameter, or `bearerToken`.",
    cache: "What the response's caching headers say, and 30 days at most.",
    example: `import { here } from "@open-geocode/client/here";

const client = here({ baseUrl: "http://localhost:8080" }); // or here({ apiKey })
const { items } = await client.geocode({ q: "10 King St W, Toronto" });
const near = await client.revgeocode({ at: "43.6489,-79.3789" });`,
    rows: {
      geocode: ["GET /v1/geocode"],
      revgeocode: ["GET /v1/revgeocode"],
      multiRevgeocode: ["POST /v1/multi-revgeocode"],
      autosuggest: ["GET /v1/autosuggest"],
      autocomplete: ["GET /v1/autocomplete"],
      discover: ["GET /v1/discover"],
      lookup: ["GET /v1/lookup"],
      browse: ["GET /v1/browse"],
      signals: ["POST /v1/signals"],
      "batch.create": ["POST /v7/batch/jobs"],
      "batch.list": ["GET /v7/batch/jobs"],
      "batch.deleteMany": ["DELETE /v7/batch/jobs"],
      "batch.status": ["GET /v7/batch/jobs/{jobId}"],
      "batch.start": ["PUT /v7/batch/jobs/{jobId}/start"],
      "batch.stop": ["PUT /v7/batch/jobs/{jobId}/stop"],
      "batch.results": ["GET /v7/batch/jobs/{jobId}/results"],
      "batch.errors": ["GET /v7/batch/jobs/{jobId}/errors"],
      "batch.delete": ["DELETE /v7/batch/jobs/{jobId}"],
      "batch.version": ["GET /v7/version"],
      "batch.health": ["GET /v7/health"],
      "batch.openapi": ["GET /v7/openapi"],
      "batch.notifications.create": ["POST /v7/batch/notifications"],
      "batch.notifications.list": ["GET /v7/batch/notifications"],
      "batch.notifications.get": ["GET /v7/batch/notifications/{notificationId}"],
      "batch.notifications.update": ["PUT /v7/batch/notifications/{notificationId}"],
      "batch.notifications.delete": ["DELETE /v7/batch/notifications/{notificationId}"],
      "batch.notifications.test": ["GET /v7/batch/notifications/{notificationId}/test"],
    },
  },
  {
    id: "precisely",
    title: "Precisely",
    importPath: "@open-geocode/client/precisely",
    factory: "precisely()",
    speaks: "Precisely's API, Geo Addressing v1 and bulk v2",
    asks: "og at /compat/precisely, or Precisely",
    client: precisely({ baseUrl }),
    credentials:
      "`apiKey` and `apiSecret`, traded at `/auth/v2/token` for a Bearer token. Against og no token is fetched, and the client has no `token` call.",
    cache: "30 days.",
    example: `import { precisely } from "@open-geocode/client/precisely";

const client = precisely({ baseUrl: "http://localhost:8080" }); // or precisely({ apiKey, apiSecret })
const { responses } = await client.geocode({
  addresses: [{ addressLines: ["10 King St W, Toronto"], country: "CA" }],
});`,
    rows: {
      geocode: ["POST /v1/geocode"],
      reverseGeocode: ["POST /v1/reverse-geocode"],
      lookup: ["POST /v1/lookup"],
      verify: ["POST /v1/verify"],
      autocomplete: ["POST /v1/autocomplete"],
      expressAutocomplete: ["POST /v1/express-autocomplete"],
      expressAutocompleteV2: ["POST /v2/express-autocomplete"],
      autocompletePostalCity: ["POST /v1/autocomplete/postal-city"],
      proximitySearch: ["POST /v1/proximity-search"],
      explainAddressCode: ["POST /v1/explain-addresscode"],
      "bulk.uploadUrl": ["POST /v2/files/upload-url"],
      "bulk.upload": ["PUT to the signed URL"],
      "bulk.files": ["GET /v2/files"],
      "bulk.deleteFile": ["DELETE /v2/files/{fileId}"],
      "bulk.geocode": ["POST /v2/bulk-geocode"],
      "bulk.verify": ["POST /v2/bulk-verify"],
      "bulk.jobs": ["GET /v2/bulk/jobs"],
      "bulk.status": ["GET /v2/bulk/jobs/{jobId}"],
      "bulk.cancel": ["DELETE /v2/bulk/jobs/{jobId}"],
      "bulk.results": ["GET the job's download URL"],
    },
  },
];

/** The dotted names of every method of a client. */
function methods(client: object, prefix = ""): string[] {
  return Object.entries(client).flatMap(([name, value]) =>
    typeof value === "function"
      ? [`${prefix}${name}`]
      : value !== null && typeof value === "object"
        ? methods(value, `${prefix}${name}.`)
        : [],
  );
}

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Escaped text with its backticked parts as code. */
const rich = (text: string): string => escape(text).replace(/`([^`]+)`/g, "<code>$1</code>");

function panel(tab: Tab): string {
  const found = methods(tab.client);
  const listed = Object.keys(tab.rows);
  const missing = found.filter((name) => !listed.includes(name));
  const gone = listed.filter((name) => !found.includes(name));
  if (missing.length > 0 || gone.length > 0)
    throw new Error(
      `The ${tab.id} tab is out of date. Not listed: ${missing.join(", ") || "none"}. No longer on the client: ${gone.join(", ") || "none"}.`,
    );
  const rows = found
    .map((name) => {
      const [endpoint, onOg] = tab.rows[name] as Row;
      const pill =
        onOg === false
          ? `<span class="pill no">unsupported</span>`
          : `<span class="pill yes">Yes</span>`;
      return `<tr><th scope="row"><code>${escape(name)}</code></th><td class="left"><code>${escape(endpoint)}</code></td><td>${pill}</td></tr>`;
    })
    .join("\n");
  return `<section role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}" hidden>
<h2><code>${escape(tab.importPath)}</code></h2>
<p>${rich(`\`${tab.factory}\` speaks ${tab.speaks}.`)}</p>
<pre><code>${escape(tab.example)}</code></pre>
<dl>
<dt>Credentials for the vendor</dt><dd>${rich(tab.credentials)}</dd>
<dt>A cached answer is kept</dt><dd>${rich(tab.cache)} An answer from og has no limit, whichever client asked.</dd>
</dl>
<div class="scroll"><table>
<thead><tr><th scope="col" class="left">Method</th><th scope="col" class="left">Endpoint</th><th scope="col">On og</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
</section>`;
}

const overview = `<section role="tabpanel" id="panel-imports" aria-labelledby="tab-imports">
<h2>The import picks the response shape</h2>
<div class="scroll"><table>
<thead><tr><th scope="col" class="left">Import</th><th scope="col" class="left">Factory</th><th scope="col" class="left">Methods, requests and responses</th><th scope="col" class="left">Asks</th></tr></thead>
<tbody>
${TABS.map(
  (tab) =>
    `<tr><th scope="row"><code>${escape(tab.importPath)}</code></th><td class="left"><code>${escape(tab.factory)}</code></td><td class="left">${escape(tab.speaks)}</td><td class="left">${escape(tab.asks)}</td></tr>`,
).join("\n")}
<tr><th scope="row"><code>@open-geocode/client/plugins</code></th><td class="left"><code>cache()</code>, <code>failover()</code>, <code>compare()</code></td><td class="left">None, they wrap any client</td><td class="left">Whatever the client asks</td></tr>
</tbody></table></div>
<h2>How a vendor client picks its server</h2>
<ul class="plain">
<li>With <code>baseUrl</code>, it asks your og server under <code>/compat/&lt;vendor&gt;</code>. No vendor key is needed, and none is sent.</li>
<li>With the vendor's credentials and no <code>baseUrl</code>, it asks the vendor itself, with the key sent the vendor's own way.</li>
<li>Either way the method names, the request and the JSON that comes back are the vendor's own. The client never translates. og's server does.</li>
</ul>
<h2>What every client shares</h2>
<ul class="plain">
<li>Retries with backoff, <code>AbortSignal</code> timeouts and request IDs.</li>
<li><code>.withResponse()</code>, which adds the HTTP response, the request ID, the server that answered and how long the answer may be kept.</li>
<li>One error class, <code>GeocoderError</code>, with a normalised <code>code</code> and the server's own error as <code>cause</code>.</li>
<li>Plugins. <code>cache</code> follows each vendor's limit, <code>failover</code> moves a call to another client of the same API, and <code>compare</code> runs two clients of the same API side by side. <code>compare</code> is refused when either side is answered by HERE.</li>
</ul>
<h2>Attribution</h2>
<p>Every og answer names its sources in <code>geocoding.attribution</code>. Show those credits wherever you show the results.</p>
</section>`;

const tabs = [{ id: "imports", title: "Imports" }, ...TABS];
const buttons = tabs
  .map(
    (tab, index) =>
      `<button role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${tab.title}</button>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>og-sdk-js clients</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1f22;--mut:#646a72;--line:#dcdfe3;--head:#f1f2f4;--code:#f1f2f4;
--yes:#1f7a3f;--yes-bg:#e6f4ea;--no:#8a5a00;--no-bg:#fbf1d9}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e6e8eb;--mut:#9aa1aa;--line:#2c3036;--head:#1d2024;--code:#1d2024;
--yes:#5cc78a;--yes-bg:#163222;--no:#e0b04a;--no-bg:#33290f;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}
p{margin:6px 0;max-width:72ch}.mut{color:var(--mut)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
h2 code{font-size:16px}th[scope=row] code{white-space:nowrap}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:12px 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:12px 0 16px}
dt{color:var(--mut)}dd{margin:0}
@media (max-width:560px){dl{grid-template-columns:1fr}dd{margin-bottom:6px}}
ul.plain{margin:6px 0;padding-left:20px;max-width:76ch}ul.plain li{margin:4px 0}
[role=tablist]{display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid var(--line);margin:20px 0 16px}
[role=tab]{font:inherit;font-weight:600;color:var(--mut);background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;margin-bottom:-1px;cursor:pointer}
[role=tab][aria-selected=true]{color:var(--fg);border-bottom-color:var(--fg)}
[role=tab]:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;min-width:640px}
th,td{padding:8px 12px;border-bottom:1px solid var(--line);text-align:center;vertical-align:middle}
tbody tr:last-child>*{border-bottom:0}
thead th{background:var(--head);font-size:13px;font-weight:600}
th[scope=row],.left{text-align:left;font-weight:400}
.pill{display:inline-block;white-space:nowrap;min-width:76px;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600}
.yes{color:var(--yes);background:var(--yes-bg)}.no{color:var(--no);background:var(--no-bg)}
</style>
</head>
<body>
<main>
<h1>og-sdk-js clients</h1>
<p class="mut">The import you pick is the response shape you get. Each tab lists one client's methods, read off the client itself.</p>
<div role="tablist" aria-label="Client">${buttons}</div>
${overview}
${TABS.map(panel).join("\n")}
</main>
<script>
const tabs = [...document.querySelectorAll("[role=tab]")];
function show(tab, focus) {
  for (const other of tabs) {
    const on = other === tab;
    other.setAttribute("aria-selected", String(on));
    other.tabIndex = on ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
  history.replaceState(null, "", "#" + tab.id.slice(4));
}
for (const tab of tabs) {
  tab.addEventListener("click", () => show(tab, false));
  tab.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    show(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], true);
  });
}
const wanted = document.getElementById("tab-" + location.hash.slice(1));
if (wanted) show(wanted, false);
</script>
</body>
</html>
`;

mkdirSync(new URL("../../../docs-preview/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../../docs-preview/index.html", import.meta.url), html);
console.log("wrote docs-preview/index.html");
