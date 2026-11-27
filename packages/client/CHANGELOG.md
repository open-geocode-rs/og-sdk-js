# @open-geocode/client

## 0.1.0

### Minor Changes

- 9f47db4: Ship `LICENSE` and `NOTICE` at the package root, add source maps, give the shared chunks stable names under `dist/shared/`, and state Node 20.19 or 22.12 and later in `engines`.
- f746d36: First release of the typed OpenGeocode client, headless autocomplete, and
  `<og-autocomplete>` Web Component.
  
  Use `@open-geocode/client` for native geocoding, reverse, place search, batches,
  and jobs. Choose the `/google`, `/mapbox`, `/here`, or `/precisely` subpath for
  that vendor's supported HTTP request and response shapes. Configure `baseUrl` to
  serve those shapes from your OpenGeocode Pack. Each provider has an autocomplete
  source and a separate bundle entry point.
  
  All clients expose timeouts, abort signals, and request IDs. Lookup plugins offer
  optional caching, comparison, and failover between clients using the same shape.
  See the client README for supported workflows and migration limits.
