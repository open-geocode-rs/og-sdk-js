---
"@open-geocode/client": minor
---

The Precisely client gains `autocompletePostalCity`, `proximitySearch` and `explainAddressCode`, for `POST /v1/autocomplete/postal-city`, `/v1/proximity-search` and `/v1/explain-addresscode`.
An og server now answers these three, and `verify` and `bulk.verify` too, in Precisely's shape.
