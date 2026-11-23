import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const base = process.env["OG_URL"];

it.runIf(base)("the published Mapbox SDK can use OG for geocoding v6", async () => {
  const query = "12 Boulevard des Moulins, Monaco";
  const accessToken = `pk.${Buffer.from('{"u":"local-test"}').toString("base64")}.dummy`;
  const upstream = require("@mapbox/mapbox-sdk");
  const geocoding = require("@mapbox/mapbox-sdk/services/geocoding-v6");
  const client = geocoding(upstream({ origin: `${base}/compat/mapbox`, accessToken }));

  const forward = await client.forwardGeocode({ query, limit: 1 }).send();
  expect(forward.statusCode).toBe(200);
  expect(forward.body.features[0].properties.full_address).toContain("12 Boulevard des Moulins");

  const [longitude, latitude] = forward.body.features[0].geometry.coordinates;
  const reverse = await client.reverseGeocode({ longitude, latitude, limit: 1 }).send();
  expect(reverse.statusCode).toBe(200);
  expect(reverse.body.features[0].properties.feature_type).toBe("address");
});
