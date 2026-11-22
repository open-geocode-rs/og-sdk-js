# @open-geocode/client

The JavaScript and TypeScript client for [open-geocode](https://github.com/open-geocode-rs/open-geocode), the self-hosted geocoder.

## Switch an existing integration

| If your app uses                  | Switch to og                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct HTTP                       | Keep the request format for the supported version. Change the URL to `<og-base-url>/compat/<vendor>/<endpoint>` and use your deployment's authentication. |
| A vendor SDK                      | Check its API version and whether it can target your og endpoint. If it cannot, use direct HTTP or this package's vendor client.                          |
| A vendor client from this package | Set its `baseUrl` to your og deployment. Keep the same methods and response handling.                                                                     |

### Compare workflows on og

Coverage depends on the Pack you serve. Each link lists the supported API versions, endpoints and differences that affect a migration.

| Vendor                  | Forward           | Reverse              | Suggestions and follow-up          | Batch geocoding            |
| ----------------------- | ----------------- | -------------------- | ---------------------------------- | -------------------------- |
| [Google](#google)       | Geocoding v4      | Geocoding v4         | Places v1 autocomplete and details | Unavailable                |
| [Mapbox](#mapbox)       | Geocoding v6      | Geocoding v6         | Search Box v1 suggest and retrieve | Geocoding v6 request batch |
| [HERE](#here)           | Search v1 geocode | Search v1 revgeocode | Search v1 autosuggest and lookup   | Batch v7 jobs              |
| [Precisely](#precisely) | Geo Addressing v1 | Geo Addressing v1    | Autocomplete and lookup            | v2 bulk jobs               |

IDs returned by og identify og records. Re-query stored vendor IDs by address or coordinates before switching, and keep follow-up calls on the same service that produced the ID.

```sh
curl --get 'http://localhost:8080/compat/mapbox/search/geocode/v6/forward' \
  --data-urlencode 'q=1 Market Street, San Francisco, CA' \
  --data-urlencode 'limit=1'
```

## Install the client

| Import                           | Factory                              | Methods, requests and responses | Asks                               |
| -------------------------------- | ------------------------------------ | ------------------------------- | ---------------------------------- |
| `@open-geocode/client`           | `createClient()`                     | og's own                        | og                                 |
| `@open-geocode/client/google`    | `google()`                           | Google's                        | og at `/compat/google`, or Google  |
| `@open-geocode/client/mapbox`    | `mapbox()`                           | Mapbox's                        | og at `/compat/mapbox`, or Mapbox  |
| `@open-geocode/client/here`      | `here()`                             | HERE's                          | og at `/compat/here`, or HERE      |
| `@open-geocode/client/precisely` | `precisely()`                        | Precisely's                     | og at `/compat/precisely`, or them |
| `@open-geocode/client/plugins`   | `cache()`, `failover()`, `compare()` | none, they wrap any client      | whatever the client asks           |

```sh
npm i @open-geocode/client
```

It has no runtime dependencies, ships as ES modules, and runs in browsers, Node, Bun and Deno.
A client you do not import never reaches your bundle.

## The og client

```ts
import { createClient } from "@open-geocode/client";

const og = createClient({ baseUrl: "http://localhost:8080" });

const { features } = await og.geocode({ q: "10 King St W, Toronto", limit: 1 });
console.log(features[0].properties.label, features[0].geometry.coordinates);
```

It answers in og's own shape, a GeoJSON `FeatureCollection`.
Every parameter and every field is typed from og's OpenAPI contract.

| Method                                                                  | og endpoint              |
| ----------------------------------------------------------------------- | ------------------------ |
| `geocode(params)`                                                       | `GET /geocode`           |
| `reverse(params)`                                                       | `GET /reverse`           |
| `autocomplete(params)`                                                  | `GET /autocomplete`      |
| `places(params)`                                                        | `GET /places`            |
| `batch.geocode(items, params?)`                                         | `POST /geocode`          |
| `batch.reverse(items, params?)`                                         | `POST /reverse`          |
| `batch.places(items, params?)`                                          | `POST /places`           |
| `jobs.create`, `status`, `wait`, `results`, `lines`, `cancel`, `delete` | `/jobs` and `/jobs/{id}` |

### Extras through `include`

A result is lean by default.
It carries its ID, layer, accuracy, name, label, address, context and source.
The extras come only when you name them in `include`, and the response type follows what you named.

```ts
const { features } = await og.geocode({
  q: "Casino de Monte-Carlo",
  include: ["timezone", "opening_hours", "bbox"],
});
features[0].properties.timezone; // typed, since it was included
features[0].properties.contact; // a type error, since it was not
```

| Extra           | What it is                                                     |
| --------------- | -------------------------------------------------------------- |
| `bbox`          | The bounding box of a result larger than a point.              |
| `address_lines` | The address as the lines of a postal address.                  |
| `access`        | The entrances mapped for the result, as points to route to.    |
| `timezone`      | The IANA timezone the result lies in.                          |
| `contact`       | Phone, website and email.                                      |
| `opening_hours` | Opening hours, in OpenStreetMap's syntax.                      |
| `brand`         | The brand a place belongs to.                                  |
| `match`         | How each address part the query states matched the result.     |
| `highlights`    | The parts of a suggestion's label that the typed text matched. |

`ALL_EXTRAS` names every one of them.
The client leaves out the extras you did not ask for before it hands you the answer, so a cached answer is lean too.

### Batch and jobs

A batch runs many lookups in one request and answers in one response.
A bad item fails alone, never the batch.

```ts
const batch = await og.batch.geocode(
  [
    { id: "a", q: "10 King St W, Toronto" },
    { id: "b", q: "24 Sussex Drive, Ottawa" },
  ],
  { country: "CA" },
);
for (const result of batch.results)
  console.log(result.id, result.status, result.response?.features[0]);
```

A job takes a file too large for one request and runs on the server.

```ts
const job = await og.jobs.create({ csv }, { address: "address" }, { output: "jsonl" });
await og.jobs.wait(job.id);
for await (const line of og.jobs.lines(job.id)) console.log(JSON.parse(line));
```

### Attribution

Every og answer names its sources in `geocoding.attribution`.
Show those credits wherever you show the results.

## Vendor client configuration

Each vendor client preserves that API's request and response shapes. With `baseUrl` set to your og deployment, the client adds `/compat/<vendor>` and omits vendor credentials. Configure your gateway's authentication separately. With the vendor's credentials and no `baseUrl`, requests go directly to the vendor.

The constructor change below applies to apps already using this package.

```diff
 import { mapbox } from "@open-geocode/client/mapbox";

-const client = mapbox({ accessToken });
+const client = mapbox({ baseUrl: "http://localhost:8080" });

 const { features } = await client.geocoding.forward({ q: "1 Market Street, San Francisco, CA" });
 console.log(features[0]?.properties.full_address);
```

| Client        | Credentials for the vendor | Sent as                                          |
| ------------- | -------------------------- | ------------------------------------------------ |
| `google()`    | `apiKey`                   | the `X-Goog-Api-Key` header                      |
| `mapbox()`    | `accessToken`              | the `access_token` query parameter               |
| `here()`      | `apiKey`, or `bearerToken` | the `apiKey` query parameter, or a Bearer header |
| `precisely()` | `apiKey` and `apiSecret`   | a Bearer token fetched from `/auth/v2/token`     |

The endpoint tables describe the current local compatibility engine. Check the engine version and Pack your deployment serves before switching traffic.

### Google

Places API (New) v1 and Geocoding API v4.

```ts
import { google } from "@open-geocode/client/google";

const client = google({ baseUrl: "http://localhost:8080" });
const { places } = await client.places.searchText({
  textQuery: "Casino de Monte-Carlo",
  fieldMask: ["places.id", "places.displayName", "places.location"],
});
const { results } = await client.geocode.address({ addressQuery: "10 King St W, Toronto" });
```

| Method                 | Google endpoint                                          | On og |
| ---------------------- | -------------------------------------------------------- | ----- |
| `places.searchText`    | `POST /v1/places:searchText`                             | yes   |
| `places.autocomplete`  | `POST /v1/places:autocomplete`                           | yes   |
| `places.get`           | `GET /v1/places/{placeId}`                               | yes   |
| `places.searchNearby`  | `POST /v1/places:searchNearby`                           | yes   |
| `places.getPhotoMedia` | `GET /v1/places/{placeId}/photos/{photoReference}/media` | no    |
| `geocode.address`      | `GET /v4/geocode/address`                                | yes   |
| `geocode.location`     | `GET /v4/geocode/location`                               | yes   |
| `geocode.place`        | `GET /v4/geocode/places/{placeId}`                       | yes   |
| `geocode.destinations` | `POST /v4/geocode/destinations`                          | yes   |

The field mask is the typed `fieldMask` parameter, sent as `X-Goog-FieldMask`.
On og, `places.searchNearby` answers nearest first under either `rankPreference`.
A type og has no category for finds no place.
og holds no photos, so on og `places.getPhotoMedia` answers Google's own error for a photo the place does not have.
On og, `geocode.destinations` states a destination's place and the entrances OpenStreetMap maps for it, the main one `PREFERRED`.

| Deliberately excluded                      | What to expect                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Google-issued Place IDs and resource names | og uses its own identifiers. Fetch details using an ID from an og response. |
| Google Photos, reviews and user ratings    | og omits this content. The photo route cannot return an image.              |
| Places Text Search pagination              | og returns one page and omits `nextPageToken`.                              |

### Mapbox

Geocoding v6 and Search Box v1.

```ts
import { mapbox } from "@open-geocode/client/mapbox";

const client = mapbox({ baseUrl: "http://localhost:8080" });
const session_token = crypto.randomUUID();
const { suggestions } = await client.searchbox.suggest({ q: "casino", session_token });
const place = await client.searchbox.retrieve({ id: suggestions[0].mapbox_id, session_token });
```

| Method                     | Mapbox endpoint                          | On og |
| -------------------------- | ---------------------------------------- | ----- |
| `geocoding.forward`        | `GET /search/geocode/v6/forward`         | yes   |
| `geocoding.reverse`        | `GET /search/geocode/v6/reverse`         | yes   |
| `geocoding.batch`          | `POST /search/geocode/v6/batch`          | yes   |
| `searchbox.suggest`        | `GET /search/searchbox/v1/suggest`       | yes   |
| `searchbox.retrieve`       | `GET /search/searchbox/v1/retrieve/{id}` | yes   |
| `searchbox.forward`        | `GET /search/searchbox/v1/forward`       | yes   |
| `searchbox.reverse`        | `GET /search/searchbox/v1/reverse`       | yes   |
| `searchbox.category`       | `GET /search/searchbox/v1/category/{id}` | yes   |
| `searchbox.listCategories` | `GET /search/searchbox/v1/list/category` | yes   |

On og, `searchbox.listCategories` gives og's own list of ids, named in English.
`searchbox.category` takes those ids, and any id whose words name a kind of place, such as `swimming_pool`.

| Deliberately excluded     | What to expect                                                         |
| ------------------------- | ---------------------------------------------------------------------- |
| Mapbox-issued feature IDs | Use the `mapbox_id` returned by og for Search Box retrieve.            |
| Geocoding v5              | The compatibility route serves Geocoding v6. A v5 client needs a port. |

Mapbox Search JS Core 1.6.0 uses a fixed Mapbox host for Geocoding v6. For that client, switch the call to v6 HTTP or use this package's Mapbox client.

### HERE

Geocoding and Search v1 and Batch v7.

```ts
import { here } from "@open-geocode/client/here";

const client = here({ baseUrl: "http://localhost:8080" });
const { items } = await client.geocode({ q: "10 King St W, Toronto" });
const near = await client.revgeocode({ at: "43.6489,-79.3789" });
```

| Method                                                                                         | HERE endpoint               | On og   |
| ---------------------------------------------------------------------------------------------- | --------------------------- | ------- |
| `geocode`                                                                                      | `GET /v1/geocode`           | yes     |
| `revgeocode`                                                                                   | `GET /v1/revgeocode`        | yes     |
| `multiRevgeocode`                                                                              | `POST /v1/multi-revgeocode` | yes     |
| `autosuggest`                                                                                  | `GET /v1/autosuggest`       | yes     |
| `autocomplete`                                                                                 | `GET /v1/autocomplete`      | yes     |
| `discover`                                                                                     | `GET /v1/discover`          | yes     |
| `lookup`                                                                                       | `GET /v1/lookup`            | yes     |
| `browse`                                                                                       | `GET /v1/browse`            | yes     |
| `signals`                                                                                      | `POST /v1/signals`          | no      |
| `batch.create`, `list`, `status`, `start`, `stop`, `results`, `errors`, `delete`, `deleteMany` | `/v7/batch/jobs`            | yes     |
| `batch.notifications.*`                                                                        | `/v7/batch/notifications`   | in part |
| `batch.version`, `health`                                                                      | `/v7/version`, `/v7/health` | yes     |
| `batch.openapi`                                                                                | `/v7/openapi`               | no      |

On og, `browse` filters by the HERE category ids og has a kind of place for, at any of their three levels.
og holds no chain or food type, so `browse` with `chains` or `foodTypes` is refused with HERE's illegal input error.
Discover can filter results along a route. An invalid `route` returns HERE's illegal input error.
og learns nothing from a signal and has no OpenAPI document of HERE's, so `signals` and `batch.openapi` answer HERE's not found error.
A notification is kept by og and called with GET when a job that names it ends.
og calls back only a host its operator allows with `serve --hook-host`, and refuses any other, so notifications work only where that is set.
A result's `scoring.fieldScore` is 1 for a part og matched and 0.5 for one it matched in part, and `queryScore` is the mean over every part the query states, one not matched counting 0.
A town whose name holds the one asked for in part, such as East Providence for Providence, still scores 0.875 beside three fully matched parts, so a caller that keeps results above 0.8 keeps it.

### Precisely

Geo Addressing v1 and the bulk jobs of v2.

```ts
import { precisely } from "@open-geocode/client/precisely";

const client = precisely({ baseUrl: "http://localhost:8080" });
const { responses } = await client.geocode({
  addresses: [{ addressLines: ["10 King St W, Toronto"], country: "CA" }],
});
```

| Method                                            | Precisely endpoint                        | On og               |
| ------------------------------------------------- | ----------------------------------------- | ------------------- |
| `geocode`                                         | `POST /v1/geocode`                        | yes                 |
| `reverseGeocode`                                  | `POST /v1/reverse-geocode`                | yes                 |
| `lookup`                                          | `POST /v1/lookup`                         | yes                 |
| `autocomplete`                                    | `POST /v1/autocomplete`                   | yes                 |
| `expressAutocomplete`, `expressAutocompleteV2`    | `POST /v1` and `/v2/express-autocomplete` | yes                 |
| `verify`                                          | `POST /v1/verify`                         | Pack-based matching |
| `autocompletePostalCity`                          | `POST /v1/autocomplete/postal-city`       | yes                 |
| `proximitySearch`                                 | `POST /v1/proximity-search`               | yes                 |
| `explainAddressCode`                              | `POST /v1/explain-addresscode`            | in part             |
| `bulk.uploadUrl`, `upload`, `files`, `deleteFile` | `/v2/files`                               | yes                 |
| `bulk.geocode`                                    | `POST /v2/bulk-geocode`                   | yes                 |
| `bulk.jobs`, `status`, `cancel`, `results`        | `/v2/bulk/jobs`                           | yes                 |
| `bulk.verify`                                     | `POST /v2/bulk-verify`                    | Pack-based matching |

On og, `explainAddressCode` explains Global Match Codes, the code og's `verify` gives, and answers Precisely's error for the other code types.
og starts a bulk job as soon as it is submitted, so a job is often done before `bulk.cancel` reaches it, and the cancel then answers Precisely's error for a job that can no longer be canceled.

When it asks Precisely, the client fetches the Bearer token itself, keeps it until shortly before it expires, and fetches a fresh one when a call answers 401.
When it asks og, no token call is made, and the client it returns has no `token` method.
A `baseUrl` given beside `apiKey`, `apiSecret` and `region` asks og, and none of the three is sent.
With `apiKey` and `apiSecret` and no `baseUrl` it also has `token()`, which hands the Bearer token to something else.

| Deliberately excluded                        | What to expect                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Precisely-issued `PB_KEY` values             | The identifier in that slot identifies an og record. Existing Precisely keys require a fresh lookup. |
| Postal certification and delivery guarantees | Verify standardizes and matches against your Pack.                                                   |
| Bulk job email delivery                      | Poll the og job status for completion.                                                               |

## What every client shares

### Retries, timeouts and request IDs

Requests that fail with a connection error, a timeout, 408, 429 or a 5xx are retried twice by default, with exponential backoff that honours `retry-after`.
A 501 is never retried, since the endpoint will not appear.
Type-ahead methods are never retried unless you ask, since a retried keystroke is already stale.
Requests time out after 60 seconds by default.
A `timeout` of `Infinity` sets no limit.
Set both on the client or on one call, as the last argument of any method.

```ts
const og = createClient({ baseUrl, timeout: 5_000, maxRetries: 3 });
await og.geocode({ q: "10 King St W" }, { timeout: 1_000, maxRetries: 0, signal });
```

`.withResponse()` gives the answer with the HTTP `Response`, the request ID, the server that answered and how long the answer may be kept.

```ts
const { data, response, requestId, server, cache } = await client.geocoding
  .forward({ q: "10 King St W" })
  .withResponse();
```

`server` is `og` for any client that points at an og server, and the vendor's name otherwise.
Every client also carries `shape`, the API it speaks, and `server`.

### Errors

Every failure is a `GeocoderError`, whichever client threw it.
Branch on `code`.

```ts
import { GeocoderError } from "@open-geocode/client";

try {
  await client.geocoding.forward({ q: "" });
} catch (error) {
  if (error instanceof GeocoderError) {
    console.log(error.code, error.provider, error.operation, error.status, error.requestId);
    console.log(error.cause); // the server's own error, with its body and headers
  }
}
```

| `code`              | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `invalid_request`   | A parameter was missing or malformed.                     |
| `unauthenticated`   | The key or token was missing or rejected.                 |
| `permission_denied` | The key does not allow this call.                         |
| `not_found`         | No such record, job or endpoint.                          |
| `conflict`          | The job is not in a state that allows this.               |
| `payload_too_large` | The upload or batch is too large.                         |
| `rate_limited`      | Too many requests, or the quota is used up.               |
| `unsupported`       | The server has no such method.                            |
| `timeout`           | The server did not answer in time.                        |
| `aborted`           | Your `signal` fired.                                      |
| `connection`        | The server could not be reached.                          |
| `unavailable`       | The server is overloaded or down for now.                 |
| `provider_error`    | The server failed, or sent an answer that cannot be read. |
| `vetoed`            | A plugin refused the call.                                |
| `unknown`           | Anything else.                                            |

`error.provider` is the server that failed and `error.operation` is the method, such as `geocoding.forward`.
`error.cause` is one of the status classes (`BadRequestError`, `RateLimitError`, `APIConnectionTimeoutError` and so on), and `error.body` is the server's error in its own shape.
On the og client, `error.problem` is og's problem document, with og's own `error_code`.

Log `code`, `message` and `requestId`, not the whole error.
`cause` and `headers` can hold request IDs and provider details that do not belong in a log.

A call ends as `timeout` when its timeout fires, and as `aborted` when your `signal` does.
Which signal fired decides, so the answer is the same in every runtime.
A `signal` of your own made with `AbortSignal.timeout()` counts as a timeout.
In both cases `error.cause.cause` is the signal's own reason, a `DOMException` named `TimeoutError` or `AbortError`.
An aborted call is never retried, and an abort ends a retry wait or a job poll at once.

## Plugins

Plugins wrap any client.
They run in the order given, each around the ones after it.
A job's own calls, such as an upload or a status check, never pass through them.

```ts
import { cache, compare, failover } from "@open-geocode/client/plugins";
```

A plugin that takes a second client needs one that speaks the same API, so both answers have the same shape.
A client built with two different shapes is refused at once.

### failover

Tries the client's own server first, and moves to the next client when it fails.

```ts
const client = mapbox({
  accessToken,
  plugins: [failover({ to: mapbox({ baseUrl: "http://localhost:8080" }) })],
});
```

By default a call moves on when the server is unreachable, slow, overloaded, rate limited or broken, or lacks the method.
A bad request or a rejected key does not move on, since the next server would be asked the same wrong thing.
`when` replaces that rule, `empty` says which answers count as empty and move on too, and `onFailover` is called on every move.

### cache

Answers a repeated call from memory.

```ts
const og = createClient({ baseUrl, plugins: [cache({ ttl: 3_600_000 })] });
```

A cache never keeps an answer longer than the server that gave it allows.
Every answer carries that rule in `cache.maxTtl`, and the plugin keeps the answer for the shorter of `ttl` and the rule.

| Answered by | Kept for at most                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| og          | No limit, whichever client asked.                                                                    |
| Google      | 30 days. See [Google's policy](https://developers.google.com/maps/documentation/geocoding/policies). |
| Mapbox      | Not at all, except a Geocoding call sent with `permanent: true`, which has no limit.                 |
| HERE        | What the response's caching headers say, and 30 days at most.                                        |
| Precisely   | 30 days.                                                                                             |

When a rule shortens or prevents caching, the plugin says so through `onLimit`, or once on the console when you gave none.
`store` takes a store of your own, `key` builds your own keys, and `methods` limits the cache to the methods you name.

### compare

Runs a second client on the same call and reports how the two answers differ.
It is made for trying og beside the vendor you use today, on your real traffic.

```ts
const candidate = google({ baseUrl: "http://localhost:8080" });
const client = google({
  apiKey,
  plugins: [compare({ with: candidate, onReport: (report) => console.log(report.comparison) })],
});
```

Your call always gets the primary client's answer, and a failing candidate never fails it.
The report holds both answers untouched, how long each took, and a comparison of where their results lie, with the distance between the two top results.

A comparison never involves HERE's own service.
A client is refused when either side of the comparison is answered by HERE.

### Your own

A plugin is an object with a `name` and a `handle(call, next)`.

```ts
import { type Plugin, veto } from "@open-geocode/client";

const guard: Plugin = {
  name: "guard",
  handle(call, next) {
    if (call.method === "places.searchNearby") throw veto("Nearby search is switched off.");
    return next();
  },
};
```

`call` holds the client's `shape` and `server`, the `method` and its `args`.
Return `next()` to pass the call on, return an outcome to answer without the server, or throw `veto()` to refuse.
