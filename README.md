# og-sdk-js

JavaScript and TypeScript SDK for [open-geocode](https://github.com/open-geocode-rs/open-geocode), the self-hosted geocoder.

| Package                                                         | What it is                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`@open-geocode/client`](packages/client)                       | The og client, and clients that speak the Google, Mapbox, HERE and Precisely APIs. No runtime dependencies. |
| [`@open-geocode/autocomplete`](packages/autocomplete)           | `<og-autocomplete>`, a drop-in address and place autocomplete Web Component.                                |
| [`@open-geocode/autocomplete-core`](packages/autocomplete-core) | The headless state, keyboard and ARIA logic under the Web Component, for a renderer of your own.            |

All three run in browsers, Node, Bun and Deno.

## Client

```sh
npm i @open-geocode/client
```

The import you pick is the response shape you get.

| Import                           | Speaks          | Asks                               |
| -------------------------------- | --------------- | ---------------------------------- |
| `@open-geocode/client`           | og's own API    | og                                 |
| `@open-geocode/client/google`    | Google's API    | og at `/compat/google`, or Google  |
| `@open-geocode/client/mapbox`    | Mapbox's API    | og at `/compat/mapbox`, or Mapbox  |
| `@open-geocode/client/here`      | HERE's API      | og at `/compat/here`, or HERE      |
| `@open-geocode/client/precisely` | Precisely's API | og at `/compat/precisely`, or them |

```ts
import { createClient } from "@open-geocode/client";

const og = createClient({ baseUrl: "http://localhost:8080" });
const { features } = await og.geocode({ q: "10 King St W, Toronto", include: ["timezone"] });
console.log(features[0].properties.label, features[0].geometry.coordinates);
```

The og client answers in og's own shape, with extras through `include`, batches and jobs.

```ts
import { mapbox } from "@open-geocode/client/mapbox";

const client = mapbox({ accessToken });
// The day you switch to og, this is the only line that changes.
// const client = mapbox({ baseUrl: "http://localhost:8080" });

const { features } = await client.geocoding.forward({ q: "10 King St W, Toronto" });
console.log(features[0].properties.full_address);
```

A vendor client uses that vendor's method names and request shape, and returns the JSON untouched.
With a `baseUrl` it asks your og server under `/compat/<vendor>`, and no vendor key is needed.
With the vendor's credentials it asks the vendor itself.
A client you do not import never reaches your bundle.

- **Typed from the source.**
  The og client is typed from og's OpenAPI contract, and each vendor client from that vendor's documented API.
- **One error.**
  Every failure is a `GeocoderError` with a normalised `code` and the server's own error as `cause`.
- **Shared plumbing.**
  Retries with backoff, `AbortSignal` timeouts, request IDs and `.withResponse()` work the same for every client.
- **Plugins.**
  `failover` falls back to another client, `cache` answers repeats from memory inside each vendor's limits, and `compare` runs og beside your vendor on your real queries and reports the difference.

The [client README](packages/client/README.md) documents every client, method, extra and error code.

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
    console.log(event.detail.label, event.detail.location);
  });
</script>
```

`base-url` points the element at an og server.
For a vendor client, give it a source.

```ts
import "@open-geocode/autocomplete";
import { mapboxSource } from "@open-geocode/autocomplete-core";
import { mapbox } from "@open-geocode/client/mapbox";

document.querySelector("og-autocomplete").source = mapboxSource(mapbox({ accessToken }));
```

There is `ogSource`, `googleSource`, `mapboxSource`, `hereSource` and `preciselySource`, one for each client's own autocomplete method.
`og-select` carries the chosen suggestion with its `label`, its `location` and the server's own object in `raw`.
Some APIs suggest without coordinates and bill a search by session.
The sources handle both.
They keep one session per search, and fetch the coordinates of the suggestion the user picks.

| Attribute     | Default | Meaning                                                            |
| ------------- | ------- | ------------------------------------------------------------------ |
| `base-url`    | none    | Where og runs. Not needed when the `source` property is set.       |
| `placeholder` | none    | Input placeholder.                                                 |
| `limit`       | `5`     | Suggestions shown.                                                 |
| `country`     | none    | Comma-separated ISO 3166-1 alpha-2 codes to limit results to.      |
| `layer`       | none    | The one og layer to suggest from, for example `address`.           |
| `focus`       | none    | `lon,lat` to prefer nearby results.                                |
| `bbox`        | none    | `min_lon,min_lat,max_lon,max_lat` to limit results to.             |
| `lang`        | none    | Comma-separated language codes to name results in.                 |
| `debounce`    | `150`   | Milliseconds to wait after a keystroke before asking.              |
| `min-chars`   | `2`     | Characters typed before the first request.                         |
| `name`        | none    | Form field name. Inside a `<form>`, the chosen label is submitted. |

Style it with `::part(input)`, `::part(list)` and `::part(option)`.
While a search is slow, the element gets a `stalled` attribute, so `og-autocomplete[stalled]` can show a spinner.
It fires `og-error` when the server fails.
The attributes from `limit` to `lang` are og's own parameters, so they apply to `base-url` only, and a source carries its own.
It follows the ARIA combobox pattern and works with the arrow keys, Enter and Escape.

## Headless core

`@open-geocode/autocomplete-core` renders nothing.
It hands your component the state and the attributes, and your component forwards input events.

```ts
import { createAutocomplete, ogSource } from "@open-geocode/autocomplete-core";
import { createClient } from "@open-geocode/client";

const source = ogSource(createClient({ baseUrl: "http://localhost:8080" }), { country: "CA" });
const ac = createAutocomplete({
  ...source,
  onSelect: async (item) => console.log((await source.resolve(item)).location),
});

ac.subscribe((state) => render(state)); // state.items, state.activeIndex, state.isOpen, state.status
input.addEventListener("input", () => ac.onInput(input.value));
input.addEventListener("keydown", (event) => ac.onKeyDown(event.key) && event.preventDefault());
Object.entries(ac.getInputAttributes()).forEach(([name, value]) => input.setAttribute(name, value));
```

Each source takes its client and that client's own autocomplete parameters.
`source.resolve` returns the picked suggestion with its coordinates, looking them up for an API that suggests without them.
The package has no dependencies, and `getItems` can be any function of your own instead.

`status` becomes `stalled` only after `stallThreshold` (300 ms), so a spinner never flashes on fast answers.

## Development

```sh
bun install
bun run build
bun run test           # unit and fixture tests of the clients and the headless core
bun run test:browser   # widget tests in Chromium, Firefox and WebKit
bun run check:packages # publint and are-the-types-wrong
bun run size           # size budgets of every client and plugin
bun run docs           # API reference into docs/
bun run docs:page      # the local docs page, into docs-preview/
bun run test:ecosystem # build a real Vite app, check a client pulls in no other vendor, and run under Node, Bun and Deno
bun run gen            # regenerate og's types from og's contract
```

Each vendor client is tested twice.
One suite replays responses in the vendor's documented shape, kept under `packages/client/test/fixtures`.
The fixtures are synthetic, with every value made up, except Google's, which are documentation examples credited in `packages/client/test/fixtures/google/NOTICE.md`.
The other suite calls a real og server's `/compat` routes, and runs when you point it at one.

```sh
# A running og server, and an address its Pack holds.
OG_URL=http://127.0.0.1:8081 OG_TEST_ADDRESS="24 Sussex Drive Ottawa" bun run test
```

`examples/plain-html` shows the widget on a checkout form.

## Licence

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
