# og-sdk-js

JavaScript and TypeScript SDK for [open-geocode](https://github.com/open-geocode-rs/open-geocode), the self-hosted geocoder.

| Package                                                         | What it is                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@open-geocode/client`](packages/client)                       | One geocoding API over og, Google, Mapbox, HERE and Precisely. No runtime dependencies.          |
| [`@open-geocode/autocomplete`](packages/autocomplete)           | `<og-autocomplete>`, a drop-in address and place autocomplete Web Component, for any provider.   |
| [`@open-geocode/autocomplete-core`](packages/autocomplete-core) | The headless state, keyboard and ARIA logic under the Web Component, for a renderer of your own. |

All three run in browsers, Node, Bun and Deno.

## Client

```sh
npm i @open-geocode/client
```

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

One class exposes one API, and each provider is an adapter behind a subpath import.
The adapters are `og()`, `google()`, `mapbox()`, `here()` and `precisely()`.
A vendor adapter calls the vendor's real API with your own key and turns the answer into the unified format.
An adapter you do not import never reaches your bundle.

- **One format.**
  Every provider answers `geocode`, `reverse`, `autocomplete`, `places`, `lookup` and `batch` in the same shape, with lean default fields and opt-in fields through `include`.
- **Honest gaps.**
  A field the provider cannot fill is `null` and named in `unavailable`, an option it cannot honour is named in `ignored`, and `capabilities` tells you both before you call.
- **One error.**
  Every failure is a `GeocoderError` with a normalised `code` and the provider's own error as `cause`.
- **Shared plumbing.**
  Retries with backoff, timeouts, request IDs and `.withResponse()` work the same for every provider.
- **Plugins.**
  `failover` falls back to another provider, `cache` answers repeats from memory, and `compare` runs two providers on your real queries and reports the difference.
- **An escape hatch.**
  `geo.native` is the provider's own API, with your credentials and the same retries.

The [client README](packages/client/README.md) documents every field, option and error code, and which provider fills what.

og's native API is also there on its own, typed from og's OpenAPI contract.

```ts
import { createClient } from "@open-geocode/client/og";

const client = createClient({ baseUrl: "http://localhost:8080" });
const collection = await client.geocode({ q: "24 Sussex Drive, Ottawa", limit: 1 });
const job = await client.jobs.create({ csv }, { address: "address" }, { output: "jsonl" });
for await (const line of client.jobs.lines(job.id)) console.log(JSON.parse(line));
```

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
For any other provider, give it a `Geocoder`.

```ts
import "@open-geocode/autocomplete";
import { Geocoder } from "@open-geocode/client";
import { mapbox } from "@open-geocode/client/mapbox";

document.querySelector("og-autocomplete").geocoder = new Geocoder({
  adapter: mapbox({ accessToken }),
});
```

`og-select` carries the chosen place in the unified format.
Some providers suggest without coordinates and bill a search by session.
The element handles both.
It keeps one session per search, and fetches the coordinates of the suggestion the user picks.

| Attribute     | Default | Meaning                                                            |
| ------------- | ------- | ------------------------------------------------------------------ |
| `base-url`    | none    | Where og runs. Not needed when the `geocoder` property is set.     |
| `placeholder` | none    | Input placeholder.                                                 |
| `limit`       | `5`     | Suggestions shown.                                                 |
| `country`     | none    | Comma-separated ISO 3166-1 alpha-2 codes to limit results to.      |
| `types`       | none    | Comma-separated result types, for example `address,street`.        |
| `focus`       | none    | `lon,lat` to prefer nearby results.                                |
| `language`    | none    | BCP 47 language code to name results in.                           |
| `debounce`    | `150`   | Milliseconds to wait after a keystroke before asking.              |
| `min-chars`   | `2`     | Characters typed before the first request.                         |
| `name`        | none    | Form field name. Inside a `<form>`, the chosen label is submitted. |

Style it with `::part(input)`, `::part(list)` and `::part(option)`.
While a search is slow, the element gets a `stalled` attribute, so `og-autocomplete[stalled]` can show a spinner.
It fires `og-error` when the provider fails.
It follows the ARIA combobox pattern and works with the arrow keys, Enter and Escape.

## Headless core

`@open-geocode/autocomplete-core` renders nothing.
It hands your component the state and the attributes, and your component forwards input events.

```ts
import { createAutocomplete, geocoderSource } from "@open-geocode/autocomplete-core";
import { Geocoder } from "@open-geocode/client";
import { og } from "@open-geocode/client/og";

const geo = new Geocoder({ adapter: og({ baseUrl: "http://localhost:8080" }) });
const source = geocoderSource(geo, { countries: ["CA"] });
const ac = createAutocomplete({
  ...source,
  onSelect: async (item) => console.log((await source.resolve(item)).location),
});

ac.subscribe((state) => render(state)); // state.items, state.activeIndex, state.isOpen, state.status
input.addEventListener("input", () => ac.onInput(input.value));
input.addEventListener("keydown", (event) => ac.onKeyDown(event.key) && event.preventDefault());
Object.entries(ac.getInputAttributes()).forEach(([name, value]) => input.setAttribute(name, value));
```

`geocoderSource` works with any adapter.
`source.resolve` returns the picked suggestion with its coordinates, looking them up for a provider that suggests without them.
The package has no dependencies, and `getItems` can be any function of your own instead.

`status` becomes `stalled` only after `stallThreshold` (300 ms), so a spinner never flashes on fast answers.

## Development

```sh
bun install
bun run build
bun run test           # unit and fixture tests of the client and the headless core
bun run test:browser   # widget tests in Chromium, Firefox and WebKit
bun run check:packages # publint and are-the-types-wrong
bun run size           # size budgets, which also prove an adapter pulls in no other adapter
bun run docs           # API reference into docs/
bun run docs:capabilities # rewrite the README's provider tables from the adapters
bun run test:ecosystem # build a real Vite app, and run the packages under Node, Bun and Deno
bun run gen            # regenerate og's types from og's contract
```

The vendor adapters are tested by replaying each vendor's documented responses, kept verbatim under `packages/client/test/fixtures`.
Two kinds of test call a real service, and both are skipped unless you set their variables.

```sh
# A running og server, and an address its Pack holds.
OG_URL=http://127.0.0.1:8081 OG_TEST_ADDRESS="24 Sussex Drive Ottawa" bun run test
# The vendors' real APIs, each with your own key.
GOOGLE_MAPS_API_KEY=... MAPBOX_ACCESS_TOKEN=... HERE_API_KEY=... \
  PRECISELY_API_KEY=... PRECISELY_API_SECRET=... bun run test
```

`examples/plain-html` shows the widget on a checkout form.

## Licence

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
