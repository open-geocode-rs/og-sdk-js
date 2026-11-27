---
"@open-geocode/autocomplete": minor
"@open-geocode/autocomplete-core": minor
---

First release of the typed OpenGeocode client, headless autocomplete, and
`<og-autocomplete>` Web Component.

Use `@open-geocode/client` for native geocoding, reverse, place search, batches,
and jobs. Choose the `/google`, `/mapbox`, `/here`, or `/precisely` subpath for
that vendor's supported HTTP request and response shapes. Configure `baseUrl` to
serve those shapes from your OpenGeocode Pack. Each provider has an autocomplete
source and a separate bundle entry point.

All clients expose timeouts, abort signals, and request IDs. Lookup plugins offer
optional caching, comparison, and failover between clients using the same shape.
See the client README for supported workflows and migration limits.
