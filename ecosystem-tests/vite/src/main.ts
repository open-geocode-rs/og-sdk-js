// Proves the published packages resolve and bundle in a real Vite app, every subpath included.
import "@open-geocode/autocomplete";
import { createAutocomplete, geocoderSource } from "@open-geocode/autocomplete-core";
import { Geocoder, GeocoderError } from "@open-geocode/client";
import { google } from "@open-geocode/client/google";
import { here } from "@open-geocode/client/here";
import { mapbox } from "@open-geocode/client/mapbox";
import { createClient, og } from "@open-geocode/client/og";
import { cache, compare, failover } from "@open-geocode/client/plugins";
import { precisely } from "@open-geocode/client/precisely";

const local = og({ baseUrl: "http://127.0.0.1:8081" });
const geo = new Geocoder({
  adapter: local,
  plugins: [
    cache(),
    failover({ to: [google({ apiKey: "key" }), mapbox({ accessToken: "token" })] }),
    compare({ with: here({ apiKey: "key" }), onReport: console.log }),
  ],
});
const other = new Geocoder({ adapter: precisely({ apiKey: "key", apiSecret: "secret" }) });
createAutocomplete(geocoderSource(geo, { limit: 5 }));
console.log(geo.provider, other.capabilities, GeocoderError.name, typeof createClient);
