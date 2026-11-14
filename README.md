# og-sdk-js

JavaScript and TypeScript SDK for [open-geocode](https://github.com/open-geocode-rs/open-geocode), the self-hosted geocoder.

| Package                                               | What it is                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@open-geocode/client`](packages/client)             | Typed client for og's API, generated from og's OpenAPI contract. No runtime dependencies. |
| [`@open-geocode/autocomplete`](packages/autocomplete) | `<og-autocomplete>`, a drop-in address and place autocomplete Web Component.              |

All three run in browsers, Node, Bun and Deno.

## Client

```sh
npm i @open-geocode/client
```

```ts
import { createClient, OgError } from "@open-geocode/client";

const og = createClient({ baseUrl: "http://localhost:8080" });

const result = await og.geocode({ q: "24 Sussex Drive, Ottawa", limit: 1 });
const [lon, lat] = result.features[0]!.geometry.coordinates;

try {
  await og.geocode({ q: "" });
} catch (error) {
  if (error instanceof OgError) console.log(error.code, error.requestId);
}
```

The client covers `geocode`, `reverse`, `autocomplete`, `places` and batch `jobs`.
Pass `headers` to `createClient` when og sits behind your own gateway.

### Retries and timeouts

Requests that fail with a connection error, a timeout, 408, 429 or a 5xx are retried twice by default, with exponential backoff that honours `retry-after`.
`autocomplete` is never retried unless you ask, since a retried keystroke is already stale.
`jobs.create` is never retried, since a retry could start the job twice.
Requests time out after 60 seconds by default.

```ts
const og = createClient({ baseUrl: "http://localhost:8080", maxRetries: 4, timeout: 10_000 });
await og.geocode({ q: "24 Sussex Drive" }, { maxRetries: 0, timeout: 2_000, signal });
```

### Errors

Every error is an `OgError` with `status`, og's `code`, `requestId` and `headers`.
Each status has its own subclass.

| Status              | Error                                                                |
| ------------------- | -------------------------------------------------------------------- |
| 400                 | `BadRequestError`                                                    |
| 401                 | `AuthenticationError`                                                |
| 403                 | `PermissionDeniedError`                                              |
| 404                 | `NotFoundError`                                                      |
| 409                 | `ConflictError`                                                      |
| 413                 | `PayloadTooLargeError`                                               |
| 422                 | `UnprocessableEntityError`                                           |
| 429                 | `RateLimitError`                                                     |
| 5xx                 | `InternalServerError`                                                |
| no answer           | `APIConnectionError`, or `APIConnectionTimeoutError` after `timeout` |
| your `signal` fired | `APIUserAbortError`                                                  |

### Request IDs and raw responses

Every parsed object carries og's request ID as `_request_id`.
`.withResponse()` returns the data with the raw `Response`, and `.asResponse()` returns the `Response` with its body unread.

```ts
const result = await og.geocode({ q: "24 Sussex Drive" });
console.log(result._request_id);

const { data, response } = await og.geocode({ q: "24 Sussex Drive" }).withResponse();
console.log(response.headers.get("x-request-id"));
```

### Batch jobs

```ts
const job = await og.jobs.create({ csv }, { address: "address" }, { output: "jsonl" });
await og.jobs.wait(job.id);
for await (const line of og.jobs.lines(job.id)) console.log(JSON.parse(line));
```

`jobs.lines` streams results as og writes them, so it also works while the job is still running.

### Logging

Set `logLevel` to `"debug"`, `"info"`, `"warn"` (the default), `"error"` or `"off"`, and pass `logger` to send logs somewhere other than `console`.

## Autocomplete

With a bundler:

```sh
npm i @open-geocode/autocomplete
```

```ts
import "@open-geocode/autocomplete";
```

Without a build step, load one script:

```html
<script src="https://cdn.jsdelivr.net/npm/@open-geocode/autocomplete/dist/og-autocomplete.iife.js"></script>
```

Then use the element anywhere, in plain HTML, React, Vue or any other framework:

```html
<og-autocomplete
  name="address"
  base-url="http://localhost:8080"
  placeholder="Start typing an address"
></og-autocomplete>
<script>
  document.querySelector("og-autocomplete").addEventListener("og-select", (event) => {
    console.log(event.detail.properties.label, event.detail.geometry.coordinates);
  });
</script>
```

| Attribute     | Default | Meaning                                                            |
| ------------- | ------- | ------------------------------------------------------------------ |
| `base-url`    | none    | Where og runs. Required.                                           |
| `placeholder` | none    | Input placeholder.                                                 |
| `limit`       | `5`     | Suggestions shown.                                                 |
| `country`     | none    | Comma-separated ISO 3166-1 alpha-2 codes to limit results to.      |
| `layer`       | none    | Only this og layer, for example `address` or `poi`.                |
| `focus`       | none    | `lon,lat` to prefer nearby results between equally good matches.   |
| `debounce`    | `150`   | Milliseconds to wait after a keystroke before asking og.           |
| `min-chars`   | `2`     | Characters typed before the first request.                         |
| `name`        | none    | Form field name. Inside a `<form>`, the chosen label is submitted. |

Style it with `::part(input)`, `::part(list)` and `::part(option)`.
While a search is slow, the element gets a `stalled` attribute, so `og-autocomplete[stalled]` can show a spinner.
It fires `og-error` when og fails.
It follows the ARIA combobox pattern and works with the arrow keys, Enter and Escape.

## Headless core

`@open-geocode/autocomplete-core` renders nothing.
It hands your component the state and the attributes, and your component forwards input events.

```ts
import { createAutocomplete } from "@open-geocode/autocomplete-core";
import { createClient } from "@open-geocode/client";
import { ogItems } from "@open-geocode/autocomplete";

const ac = createAutocomplete({
  getItems: ogItems(createClient({ baseUrl: "http://localhost:8080" }), { country: "CA" }),
  getItemLabel: (item) => item.properties.label,
  onSelect: (item) => console.log(item.geometry.coordinates),
});

ac.subscribe((state) => render(state)); // state.items, state.activeIndex, state.isOpen, state.status
input.addEventListener("input", () => ac.onInput(input.value));
input.addEventListener("keydown", (event) => ac.onKeyDown(event.key) && event.preventDefault());
Object.entries(ac.getInputAttributes()).forEach(([name, value]) => input.setAttribute(name, value));
```

`status` becomes `stalled` only after `stallThreshold` (300 ms), so a spinner never flashes on fast answers.

## Development

```sh
bun install
bun run build
bun run test           # client unit tests
bun run test:browser   # widget tests in Chromium, Firefox and WebKit
OG_URL=http://127.0.0.1:8080 bun run test   # also run the live og test
bun run check:packages # publint and are-the-types-wrong
bun run size           # size budget
bun run docs           # API reference into docs/
bun run test:ecosystem # build a real Vite app against the packages
bun run gen            # regenerate client types from og's contract
```

`examples/plain-html` shows the widget on a checkout form.

## Licence

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
