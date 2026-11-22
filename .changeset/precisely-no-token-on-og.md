---
"@open-geocode/client": minor
---

`precisely({ baseUrl })` returns a client with no `token` call, since og takes no token.
`precisely({ apiKey, apiSecret })` returns `PreciselyVendorClient`, which keeps `token()`.
The options are now `PreciselyOgOptions` or `PreciselyVendorOptions`, so giving both a `baseUrl` and a key is a type error.
