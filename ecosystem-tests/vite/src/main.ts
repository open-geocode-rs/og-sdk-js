// Proves the published packages resolve and bundle in a real Vite app.
import "@open-geocode/autocomplete";
import { createAutocomplete } from "@open-geocode/autocomplete-core";
import { createClient, OgError } from "@open-geocode/client";

const og = createClient({ baseUrl: "http://127.0.0.1:8080" });
createAutocomplete({ getItems: async () => [], getItemLabel: String });
console.log(typeof og.geocode, OgError.name);
