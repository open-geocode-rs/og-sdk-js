---
"@open-geocode/client": minor
"@open-geocode/autocomplete": minor
"@open-geocode/autocomplete-core": minor
---

The import picks the response shape.
`@open-geocode/client` is the client for og's own API, with og's responses, its extras through `include`, batches and jobs.
`@open-geocode/client/google`, `/mapbox`, `/here` and `/precisely` are clients that speak each vendor's own API, with that vendor's method names, requests and untouched responses.
Each of them asks an og server under `/compat/<vendor>` when given a `baseUrl`, and the vendor itself when given the vendor's credentials.
Every client shares retries, timeouts, request IDs, `.withResponse()` and plugins.
`@open-geocode/client/plugins` adds `failover`, `cache` and `compare`, which work on any client.
Every failure is a `GeocoderError` with a normalised `code` and the server's own error as `cause`.
`@open-geocode/autocomplete-core` gains a source for the og client and one for each vendor client, and `<og-autocomplete>` takes any of them through its `source` property.
