import { describe, expect, it } from "vitest";
import { google } from "../src/providers/google/index.ts";
import { here } from "../src/providers/here/index.ts";
import { mapbox } from "../src/providers/mapbox/index.ts";
import { precisely } from "../src/providers/precisely/index.ts";
import { distance } from "../src/plugins/compare.ts";
import fixtures from "./fixtures/nad.json" with { type: "json" };

const baseUrl = process.env["OG_USA_URL"];
const options = { baseUrl, logLevel: "off", maxRetries: 0 } as const;
type Coordinates = readonly [number | undefined, number | undefined] | undefined;

describe.runIf(baseUrl)("US address register through the SDK", () => {
  const clients = baseUrl
    ? {
        google: google(options),
        mapbox: mapbox(options),
        here: here(options),
        precisely: precisely({ ...options, baseUrl }),
      }
    : undefined;

  const vendors = {
    Google: async (q: string): Promise<Coordinates> => {
      const result = (await clients!.google.geocode.address({ addressQuery: q })).results?.[0]
        ?.location;
      return [result?.longitude, result?.latitude];
    },
    Mapbox: async (q: string): Promise<Coordinates> =>
      (await clients!.mapbox.geocoding.forward({ q, limit: 1 })).features[0]?.geometry?.coordinates,
    HERE: async (q: string): Promise<Coordinates> => {
      const result = (await clients!.here.geocode({ q, limit: 1 })).items[0]?.position;
      return [result?.lng, result?.lat];
    },
    Precisely: async (q: string): Promise<Coordinates> =>
      (await clients!.precisely.geocode({ addresses: [{ addressLines: [q], country: "US" }] }))
        .responses[0]?.results?.[0]?.location?.feature?.geometry.coordinates,
  };
  it.each(Object.entries(vendors))(
    "%s locates clean and messy addresses",
    async (_vendor, lookup) => {
      for (const form of ["full", "messy"] as const) {
        const misses: string[] = [];
        for (const row of fixtures) {
          const [lon, lat] = (await lookup(row[form])) ?? [];
          expect(Number.isFinite(lon) && Number.isFinite(lat), row[form]).toBe(true);
          const error = distance({ lat: row.lat, lon: row.lon }, { lat: lat!, lon: lon! });
          if (error > 50) misses.push(`${row.state} (${Math.round(error)} m)`);
        }
        // The baseline has one point outside 50 m. Keep all fixtures in the sample.
        expect(misses.length, `${form}: ${misses.join(", ")}`).toBeLessThanOrEqual(1);
      }
    },
    45_000,
  );
});
