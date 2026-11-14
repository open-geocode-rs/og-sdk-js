# og-sdk-js

JavaScript and TypeScript SDK for [open-geocode](https://github.com/open-geocode-rs/open-geocode), the self-hosted geocoder.

| Package                                               | What it is                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`@open-geocode/client`](packages/client)             | Typed client for og's API, generated from og's OpenAPI contract. No runtime dependencies. |
| [`@open-geocode/autocomplete`](packages/autocomplete) | `<og-autocomplete>`, a drop-in address and place autocomplete Web Component.              |

Both run in browsers, Node, Bun and Deno.

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
Pass `{ signal }` as the last argument of any call to cancel it.

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
It follows the ARIA combobox pattern and works with the arrow keys, Enter and Escape.

## Development

```sh
bun install
bun run build
bun run test           # client unit tests
bun run test:browser   # widget tests in Chromium, Firefox and WebKit
OG_URL=http://127.0.0.1:8080 bun run test   # also run the live og test
bun run gen            # regenerate client types from og's contract
```

`examples/plain-html` shows the widget on a checkout form.

## Licence

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
