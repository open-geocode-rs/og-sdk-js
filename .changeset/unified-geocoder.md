---
"@open-geocode/client": minor
"@open-geocode/autocomplete": minor
"@open-geocode/autocomplete-core": minor
---

One geocoding API over any provider.
`Geocoder` exposes `geocode`, `reverse`, `autocomplete`, `places`, `lookup` and `batch`, and answers in one format whichever adapter it is given.
The adapters are `@open-geocode/client/og`, `/google`, `/mapbox`, `/here` and `/precisely`.
Results have a lean default shape, opt-in fields through `include`, and a list of the fields and options the provider could not serve.
`@open-geocode/client/plugins` adds `failover`, `cache` and `compare`.
Every failure is a `GeocoderError` with a normalised `code` and the provider's own error as `cause`.
`<og-autocomplete>` takes any `Geocoder` through its `geocoder` property, and `@open-geocode/autocomplete-core` gains `geocoderSource`.
The widget's `layer` attribute is now `types`, `ogItems` is replaced by `geocoderSource`, and `og-select` carries a place in the unified format.
