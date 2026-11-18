# @open-geocode/client

One geocoding API over any provider.
You write your code once against `Geocoder`, and an adapter decides who answers.
Switching provider is one line, and an adapter you do not import never reaches your bundle.

```ts
import { Geocoder } from "@open-geocode/client";
import { google } from "@open-geocode/client/google";
import { og } from "@open-geocode/client/og";

const geo = new Geocoder({ adapter: google({ apiKey }) });
// The day you switch, this is the only line that changes.
// const geo = new Geocoder({ adapter: og({ baseUrl: "http://localhost:8080" }) });

const { results } = await geo.geocode("10 King St W, Toronto");
console.log(results[0].label, results[0].location);
```

The package has no runtime dependencies, ships ESM only, and runs in browsers, Node, Bun and Deno.

## Adapters

| Import                           | Factory       | Talks to                                                  |
| -------------------------------- | ------------- | --------------------------------------------------------- |
| `@open-geocode/client/og`        | `og()`        | An og server you host, through og's native API.           |
| `@open-geocode/client/google`    | `google()`    | Google Geocoding API v4 and Places API (New) v1.          |
| `@open-geocode/client/mapbox`    | `mapbox()`    | Mapbox Geocoding v6 and Search Box v1.                    |
| `@open-geocode/client/here`      | `here()`      | HERE Geocoding and Search v7 and Batch v7.                |
| `@open-geocode/client/precisely` | `precisely()` | Precisely Geo Addressing v1, on the Data Integrity Suite. |

A vendor adapter calls the vendor's real API with your own key and turns the answer into the unified format.
Nothing passes through a server of ours.

```ts
og({ baseUrl: "http://localhost:8080" });
google({ apiKey });
mapbox({ accessToken });
here({ apiKey });
precisely({ apiKey, apiSecret, defaultCountry: "US" });
```

Every adapter also takes `fetch`, `headers`, `timeout`, `maxRetries`, `logLevel` and `logger`.

## Operations

```ts
await geo.geocode("10 King St W, Toronto", { limit: 3, countries: ["CA"] });
await geo.geocode({ address: "10 King St W", locality: "Toronto", region: "ON", country: "CA" });
await geo.reverse({ lat: 43.6489, lon: -79.3789 });
await geo.autocomplete("10 King", { focus: { lat: 43.65, lon: -79.38 }, session });
await geo.places("coffee near union station", { focus: { lat: 43.645, lon: -79.38 } });
await geo.lookup(results[0].id);
await geo.batch.geocode(["10 King St W, Toronto", "24 Sussex Drive, Ottawa"]);
await geo.batch.reverse([{ lat: 43.6489, lon: -79.3789 }]);
```

The search options are the same for every provider.

| Option       | Meaning                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `limit`      | The most results to return.                                                                                |
| `language`   | One BCP 47 code, or a list of at most 20. The first names the results, the rest come back as translations. |
| `countries`  | Return only results in these countries, as ISO 3166-1 alpha-2 codes.                                       |
| `focus`      | Prefer results near this `{ lat, lon }`.                                                                   |
| `bounds`     | Return only results inside this `[west, south, east, north]` box.                                          |
| `types`      | Return only results of these types.                                                                        |
| `include`    | The opt-in fields to return.                                                                               |
| `session`    | Groups the keystrokes of one search and the lookup that ends it, for providers that bill so.               |
| `signal`     | Cancels the request.                                                                                       |
| `timeout`    | Milliseconds before the request fails.                                                                     |
| `maxRetries` | Times a failed request is retried.                                                                         |

When a provider cannot honour an option, the option is left out and the result names it in `ignored`.
Pass `strict: true` to the `Geocoder` to fail with `unsupported` instead.

A `language` list longer than 20 codes fails with `invalid_request` before any provider is asked.
Every further language adds a name to each result and to each area around it, so the cap keeps the size of an answer bounded.
`translations` holds the result's own name in each further language, and never in the first.
A result whose name is put together from parts, such as an address, has none.

## Response format

Every operation answers with the same object.

```ts
{
  provider: "google",          // the adapter that answered
  operation: "geocode",
  results: [/* places */],
  attribution: [{ text, url, licence }],  // credits the provider asks you to show
  unavailable: ["confidence"], // fields this provider can never fill for this operation
  ignored: [],                 // options of this call the provider could not honour
}
```

Three rules hold for every provider.

1. Every default field is always present, and `null` means the provider gave no value for this record.
2. An opt-in field is present only when `include` asks for it, and is `null` when the provider gave no value.
3. `unavailable` names the fields the provider can never fill for the operation, so you can tell "cannot" from "no data for this record".

No value is ever made up to fill a gap.

### Attribution

You must show `attribution` wherever you show results.
Each entry is a credit its provider requires, and the adapter fills it for you.

| Adapter       | Credit                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `og()`        | The credits og sends, such as `© OpenStreetMap contributors`, with their licence and link.   |
| `google()`    | `Google Maps`, unchanged and untranslated, then each data provider Google names for a place. |
| `mapbox()`    | The notice Mapbox sends with each answer.                                                    |
| `here()`      | `© <year> HERE`.                                                                             |
| `precisely()` | None. Precisely's public documentation states no credit, so check your contract.             |

A provider may ask for more than text, such as a logo or a placement, so read its terms for how to show the credit.

### Default fields

| Field                   | Type                   | Meaning                                                                                                                                    |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                    | `string \| null`       | The provider's ID for the record. Pass it to `lookup` on the same provider.                                                                |
| `type`                  | `PlaceType`            | `address`, `street`, `intersection`, `poi`, `postcode`, `neighbourhood`, `locality`, `district`, `region`, `country`, `area` or `unknown`. |
| `name`                  | `string`               | Short name. House number and street for an address, else the name of the place.                                                            |
| `label`                 | `string`               | One-line display text.                                                                                                                     |
| `location`              | `{ lat, lon } \| null` | `null` on a suggestion that carries no coordinates. Resolve it with `lookup`.                                                              |
| `accuracy`              | `Accuracy \| null`     | `rooftop`, `interpolated`, `street`, `centroid` or `approximate`.                                                                          |
| `confidence`            | `number \| null`       | How sure the provider is of the match, from 0 to 1.                                                                                        |
| `distance`              | `number \| null`       | Metres from the reverse point, or from `focus`.                                                                                            |
| `address.houseNumber`   | `string \| null`       |                                                                                                                                            |
| `address.street`        | `string \| null`       |                                                                                                                                            |
| `address.unit`          | `string \| null`       | The unit, suite or apartment, as written.                                                                                                  |
| `address.neighbourhood` | `string \| null`       |                                                                                                                                            |
| `address.locality`      | `string \| null`       | City or town.                                                                                                                              |
| `address.district`      | `string \| null`       | County, prefecture or the like.                                                                                                            |
| `address.region`        | `string \| null`       | State or province.                                                                                                                         |
| `address.regionCode`    | `string \| null`       | The region's short code without the country, such as `ON`.                                                                                 |
| `address.postcode`      | `string \| null`       |                                                                                                                                            |
| `address.country`       | `string \| null`       |                                                                                                                                            |
| `address.countryCode`   | `string \| null`       | ISO 3166-1 alpha-2 in upper case.                                                                                                          |

### Opt-in fields

Ask for these by name.
The result's type follows what you ask for, so `results[0].bbox` exists for the compiler only when `include` has `"bbox"`.

```ts
const { results, raw } = await geo.places("coffee", { include: ["openingHours", "rating", "raw"] });
```

| `include`        | Type                                                                  | Meaning                                                                              |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bbox`           | `[west, south, east, north]`                                          | The box that frames the result on a map.                                             |
| `context`        | `{ neighbourhood, sublocality, locality, district, region, country }` | The containing areas, each with `name`, `id`, `code`, `wikidata` and `translations`. |
| `addressDetails` | `{ unitType, building, floor, sublocality, postcodeSuffix }`          | Address parts beyond the default set.                                                |
| `addressLines`   | `string[]`                                                            | The address as postal lines, top to bottom.                                          |
| `streetParts`    | `{ prefix, name, type, suffix }`                                      | The street name split into its parts, as written.                                    |
| `categories`     | `{ id, name, primary }[]`                                             | POI categories, in the provider's own vocabulary.                                    |
| `brand`          | `{ name, id, wikidata }`                                              | The chain a place belongs to.                                                        |
| `contact`        | `{ phone, website, email }`                                           |                                                                                      |
| `openingHours`   | `{ text, openNow }`                                                   | Display lines as the provider writes them, and whether it is open.                   |
| `rating`         | `{ value, count }`                                                    |                                                                                      |
| `businessStatus` | `"operational" \| "closed_temporarily" \| "closed_permanently"`       |                                                                                      |
| `timezone`       | `{ name, utcOffsetMinutes }`                                          | IANA name and the current offset.                                                    |
| `accessPoints`   | `{ lat, lon, kind }[]`                                                | Points to route to, such as an entrance.                                             |
| `match`          | `{ score, components }`                                               | How each address part of the query matched.                                          |
| `highlights`     | `{ start, end }[]`                                                    | The parts of `label` that match what was typed.                                      |
| `translations`   | `Record<string, string>`                                              | The result's name in each further language asked for.                                |
| `plusCode`       | `{ global, compound }`                                                |                                                                                      |
| `raw`            | `unknown`                                                             | The provider's own record on each place, and its whole body as `raw` on the result.  |

Where a provider bills by the fields you ask for, the adapter asks for the default fields plus exactly what `include` names.

### Which provider fills what

<!-- capabilities:start -->

Operations.

|                 | `og`   | `google`                       | `mapbox`                       | `here`                         | `precisely` |
| --------------- | ------ | ------------------------------ | ------------------------------ | ------------------------------ | ----------- |
| `geocode`       | yes    | yes                            | yes                            | yes                            | yes         |
| `reverse`       | yes    | yes                            | yes                            | yes                            | yes         |
| `autocomplete`  | yes    | yes, location through `lookup` | yes, location through `lookup` | yes, location through `lookup` | yes         |
| `places`        | yes    | yes                            | yes                            | yes                            | no          |
| `lookup`        | yes    | yes                            | yes                            | yes                            | yes         |
| `batch.geocode` | native | emulated                       | native                         | native                         | native      |
| `batch.reverse` | native | emulated                       | native                         | native                         | native      |

Fields.
Each cell names the operations the provider fills the field on, by initial.
`g` is geocode, `r` reverse, `a` autocomplete, `p` places and `l` lookup, `all` is every operation the provider has, and `no` is none.
`type`, `name` and `label` are filled by every provider on every operation, and `raw` is always available.
`distance` is the provider's own figure where the table lists it.
Anywhere else it is measured here, from the reverse point or from `focus` to the result's `location`.

| Field            | `og`    | `google` | `mapbox` | `here`  | `precisely` |
| ---------------- | ------- | -------- | -------- | ------- | ----------- |
| `id`             | all     | all      | all      | all     | all         |
| `location`       | all     | g r p l  | g r p l  | all     | all         |
| `accuracy`       | all     | g r      | g r p l  | all     | all         |
| `confidence`     | all     | no       | no       | g       | no          |
| `distance`       | g r a p | r a      | r a p    | g r a p | r a         |
| `address`        | all     | g r p l  | all      | all     | all         |
| `bbox`           | g r p l | g r p l  | g r p l  | all     | no          |
| `context`        | all     | no       | all      | no      | no          |
| `addressDetails` | all     | g r p l  | all      | all     | all         |
| `addressLines`   | g r l   | g r p l  | no       | no      | all         |
| `streetParts`    | all     | no       | no       | all     | no          |
| `categories`     | all     | p l      | a p l    | all     | no          |
| `brand`          | all     | no       | a p l    | a p l   | no          |
| `contact`        | a p l   | p l      | a p l    | a p l   | no          |
| `openingHours`   | a p l   | p l      | a p l    | a p l   | no          |
| `rating`         | no      | p l      | a p l    | no      | no          |
| `businessStatus` | no      | p l      | a p l    | l       | no          |
| `timezone`       | p l     | p l      | no       | all     | no          |
| `accessPoints`   | g r p l | p l      | g r p l  | all     | no          |
| `match`          | g       | no       | g        | g       | g a         |
| `highlights`     | a       | a        | no       | a       | a           |
| `translations`   | all     | no       | g r      | all     | no          |
| `plusCode`       | no      | g r p l  | no       | no      | no          |

Options.
`structured` is an address given in parts to `geocode`.
A provider without it is sent the parts joined into one line.

| Option       | `og`    | `google` | `mapbox` | `here`  | `precisely` |
| ------------ | ------- | -------- | -------- | ------- | ----------- |
| `limit`      | g r a p | g r a p  | g r a p  | g r a p | g r a       |
| `language`   | all     | all      | all      | all     | no          |
| `countries`  | g a p   | a        | g r a p  | g a p   | g r a       |
| `focus`      | g a p   | a p      | g a p    | g a p   | a           |
| `bounds`     | g a p   | a p      | g a p    | a p     | no          |
| `types`      | g r a p | g r a p  | g r a p  | g r a p | no          |
| `session`    | no      | a l      | a l      | no      | a           |
| `structured` | g       | g        | g        | g       | g           |

<!-- capabilities:end -->

The same facts are available at run time.

```ts
geo.capabilities.autocomplete?.coordinates; // false when suggestions need a lookup for their location
geo.capabilities.places?.fields.includes("openingHours");
geo.capabilities.geocode?.options.includes("bounds");
geo.capabilities.batch.geocode; // "native", "emulated" or false
```

## Batch

`geo.batch.geocode` and `geo.batch.reverse` take any number of items and answer one item per input, in input order.
An item that fails carries its own `error` and does not fail the batch.

```ts
const batch = await geo.batch.geocode(addresses, {
  concurrency: 8,
  onProgress: ({ done, total }) => console.log(`${done}/${total}`),
});
console.log(batch.mode, batch.summary);
for (const item of batch.items)
  console.log(item.index, item.results[0]?.location, item.error?.code);
```

A provider with a batch endpoint of its own runs the batch there, and `mode` is `native`.
For any other provider the batch runs as single calls, at most `concurrency` at once, and `mode` is `emulated`.
An emulated batch goes through the plugins call by call, so a cache serves repeated addresses.
A native batch does not go through the plugins.

## Errors

Every failure is a `GeocoderError`, whichever provider failed.
Branch on `code`.

```ts
import { GeocoderError } from "@open-geocode/client";

try {
  await geo.geocode("");
} catch (error) {
  if (error instanceof GeocoderError) {
    console.log(error.code, error.provider, error.operation, error.status, error.requestId);
    console.log(error.cause); // the provider's own error, with its body and headers
  }
}
```

| `code`              | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `invalid_request`   | A parameter was missing or malformed.                       |
| `unauthenticated`   | The key or token was missing or rejected.                   |
| `permission_denied` | The key does not allow this call.                           |
| `not_found`         | No such record, job or endpoint.                            |
| `conflict`          | The job is not in a state that allows this.                 |
| `payload_too_large` | The upload or batch is too large.                           |
| `rate_limited`      | Too many requests, or the quota is used up.                 |
| `unsupported`       | The provider has no such operation or option.               |
| `timeout`           | The provider did not answer in time.                        |
| `aborted`           | Your `signal` fired.                                        |
| `connection`        | The provider could not be reached.                          |
| `unavailable`       | The provider is overloaded or down for now.                 |
| `provider_error`    | The provider failed, or sent an answer that cannot be read. |
| `vetoed`            | A plugin refused the call.                                  |
| `unknown`           | Anything else.                                              |

`error.cause` is one of the status classes (`BadRequestError`, `RateLimitError`, `APIConnectionTimeoutError` and so on), and its `body` is the provider's error in the provider's own shape.
`GeocoderError` extends `OgError`, the base class of them all.

## Retries, timeouts and request IDs

Requests that fail with a connection error, a timeout, 408, 429 or a 5xx are retried twice by default, with exponential backoff that honours `retry-after`.
`autocomplete` is never retried unless you ask, since a retried keystroke is already stale.
Requests time out after 60 seconds by default.
Set both on the adapter, on the `Geocoder`, or on one call.

```ts
const geo = new Geocoder({ adapter: og({ baseUrl }), timeout: 5_000, maxRetries: 3 });
await geo.geocode("10 King St W", { timeout: 1_000, maxRetries: 0, signal });
```

`.withResponse()` returns the result with the HTTP `Response` and the provider's request ID.

```ts
const { data, response, requestId } = await geo.geocode("10 King St W").withResponse();
```

## Plugins

Plugins form an ordered pipeline around every call.
Each one wraps the plugins after it, and the adapter is the last step.

```ts
import { cache, compare, failover } from "@open-geocode/client/plugins";
```

### failover

Tries your adapter first and falls back to others when it fails.
The result's `provider` names the adapter that answered.

```ts
const geo = new Geocoder({
  adapter: og({ baseUrl }),
  plugins: [failover({ to: google({ apiKey }), onFailover: ({ error }) => log(error) })],
});
```

It falls back when the provider is unreachable, slow, overloaded, rate limited or broken, or lacks the operation.
It does not fall back on a bad request or a rejected key, since the next provider would be asked the same wrong thing.
Pass `when` to decide yourself, and `onEmpty: true` to fall back on an answer with no results too.

### cache

Answers a repeated call from memory.

```ts
cache({ ttl: 60_000, max: 1000, operations: ["geocode", "reverse"] });
```

A cache never keeps an answer longer than its provider allows.
Each adapter states its provider's rule in `capabilities.cache.maxTtl`, in milliseconds, and the plugin follows it by default.

| Adapter       | An answer may be kept                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| `og()`        | Without limit.                                                                        |
| `google()`    | For 30 days.                                                                          |
| `mapbox()`    | Not at all. With `permanent: true`, geocode, reverse and batch answers without limit. |
| `here()`      | Not at all, until its terms are checked.                                              |
| `precisely()` | Not at all, until its terms are checked.                                              |

The plugin keeps an answer for the shorter of your `ttl` and the provider's rule, and keeps nothing where the rule is `0`.
It never does so silently.
`onLimit` is called each time, and without it the plugin warns on the console the first time each case arises.

```ts
cache({
  ttl: 90 * 86_400_000,
  onLimit: ({ provider, operation, action, allowed }) => log(provider, operation, action, allowed),
});
```

An answer that `failover` got from another provider is not kept, since the cache was set up for the provider you asked.
`mapbox({ accessToken, permanent: true })` tells Mapbox you intend to store geocode, reverse and batch answers, which Mapbox bills and licenses differently.
Pass `store` to keep entries somewhere of your own, such as a shared key-value store.
The rules above are the SDK's reading of each provider's public terms, so check your own contract before you rely on one.

### compare

Runs a second adapter on the same query and reports how the two answers differ.
Your code still gets the first adapter's answer, at the first adapter's speed, and a failing second adapter never fails the call.
It is a free side-by-side for a team that wants to see how another provider would have answered its real traffic.

```ts
const geo = new Geocoder({
  adapter: google({ apiKey }),
  plugins: [
    compare({
      with: og({ baseUrl }),
      sample: 0.1,
      onReport: ({ primary, candidate, comparison }) =>
        console.log(primary.ms, candidate.ms, comparison?.agree, comparison?.topDistance),
    }),
  ],
});
```

The report holds each side's result, error and latency, the metres between the two top results, the address parts that differ, and which results the second adapter lacks.

### Your own

A plugin is an object with a `name` and a `handle`.

```ts
import { veto, type Plugin } from "@open-geocode/client";

const audit: Plugin = {
  name: "audit",
  async handle(call, next) {
    if (call.operation === "places") throw veto("places search is switched off here");
    const started = performance.now();
    const outcome = await next(call); // change call.request before, or the outcome after
    console.log(call.operation, outcome.result.provider, performance.now() - started);
    return outcome;
  },
};
```

## The escape hatch

`geo.native` is the provider's own API, for anything outside the unified surface.
It uses the adapter's credentials and the same retries and timeouts.

```ts
const googleGeo = new Geocoder({ adapter: google({ apiKey }) });
const nearby = await googleGeo.native.places({
  method: "POST",
  path: "/v1/places:searchNearby",
  headers: { "X-Goog-FieldMask": "places.id,places.displayName" },
  body: {
    locationRestriction: {
      circle: { center: { latitude: 43.65, longitude: -79.38 }, radius: 500 },
    },
  },
});

const ogGeo = new Geocoder({ adapter: og({ baseUrl }) });
const job = await ogGeo.native.jobs.create({ csv }, { address: "address" });
```

For og, `native` is the typed client for og's own API, also available on its own.

```ts
import { createClient } from "@open-geocode/client/og";

const client = createClient({ baseUrl: "http://localhost:8080" });
const collection = await client.geocode({ q: "24 Sussex Drive, Ottawa", limit: 1 });
for await (const line of client.jobs.lines(job.id)) console.log(JSON.parse(line));
```

## Writing an adapter

An adapter is a plain object that implements the `Adapter` interface from this package.
It declares what it supports in `capabilities`, and the `Geocoder` does the rest.
`createTransport`, `nativeRequest` and the other helpers the built-in adapters use are exported for yours.
