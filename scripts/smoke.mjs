// Imports the built client and makes one call with a fake fetch.
// CI runs it under Node, Bun and Deno to prove the package needs no runtime-specific APIs.
import { createClient } from "../packages/client/dist/index.js";

const og = createClient({
  baseUrl: "http://og.test",
  fetch: async (url) =>
    new Response(
      JSON.stringify({ type: "FeatureCollection", geocoding: { url: String(url) }, features: [] }),
      {
        headers: { "content-type": "application/json" },
      },
    ),
});

const result = await og.geocode({ q: "24 Sussex Drive" });
if (result.geocoding.url !== "http://og.test/geocode?q=24+Sussex+Drive") {
  throw new Error(`unexpected request URL ${result.geocoding.url}`);
}
console.log("smoke ok");
