import { defineConfig } from "tsdown";

export default defineConfig({
  // One entry per subpath export. Shared code lands in chunks, so each adapter loads alone.
  entry: {
    index: "src/index.ts",
    og: "src/og.ts",
    google: "src/google.ts",
    mapbox: "src/mapbox.ts",
    here: "src/here.ts",
    precisely: "src/precisely.ts",
    plugins: "src/plugins/index.ts",
  },
  format: ["esm"],
  dts: true,
  platform: "neutral",
  copy: ["../../LICENSE", "../../NOTICE"],
});
