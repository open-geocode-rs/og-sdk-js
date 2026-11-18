// Proves the published packages resolve and bundle in a real Vite app, every subpath included.
import "@open-geocode/autocomplete";
import {
  createAutocomplete,
  googleSource,
  hereSource,
  mapboxSource,
  ogSource,
  preciselySource,
} from "@open-geocode/autocomplete-core";
import { createClient, GeocoderError } from "@open-geocode/client";
import { google } from "@open-geocode/client/google";
import { here } from "@open-geocode/client/here";
import { mapbox } from "@open-geocode/client/mapbox";
import { cache, compare, failover } from "@open-geocode/client/plugins";
import { precisely } from "@open-geocode/client/precisely";

const baseUrl = "http://127.0.0.1:8081";
const og = createClient({
  baseUrl,
  plugins: [cache(), failover({ to: createClient({ baseUrl: "http://127.0.0.1:8082" }) })],
});
const vendor = mapbox({
  accessToken: "token",
  plugins: [compare({ with: mapbox({ baseUrl }), onReport: console.log })],
});
createAutocomplete(ogSource(og, { limit: 5 }));
createAutocomplete(mapboxSource(vendor));
createAutocomplete(googleSource(google({ apiKey: "key" })));
createAutocomplete(hereSource(here({ baseUrl })));
createAutocomplete(preciselySource(precisely({ apiKey: "key", apiSecret: "secret" }), "US"));
console.log(og.shape, vendor.server, GeocoderError.name);
