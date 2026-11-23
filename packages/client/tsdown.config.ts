import { defineConfig } from "tsdown";

export default defineConfig({
  // One entry per subpath export. Shared code lands in chunks, so each client loads alone.
  entry: {
    index: "src/index.ts",
    google: "src/providers/google/index.ts",
    mapbox: "src/providers/mapbox/index.ts",
    here: "src/providers/here/index.ts",
    precisely: "src/providers/precisely/index.ts",
    plugins: "src/plugins/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "neutral",
  copy: ["../../LICENSE", "../../NOTICE"],
});
