import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    platform: "browser",
    copy: ["../../LICENSE", "../../NOTICE"],
  },
  {
    // One <script> file for pages with no build step. Bundles the client.
    entry: { "og-autocomplete": "src/index.ts" },
    format: ["iife"],
    globalName: "OgAutocomplete",
    platform: "browser",
    minify: true,
    deps: { alwaysBundle: [/.*/] },
    outputOptions: { entryFileNames: "[name].iife.js" },
  },
]);
