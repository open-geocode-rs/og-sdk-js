import { readFileSync, writeFileSync } from "node:fs";
import { withCapabilities } from "./capabilities.ts";

const path = new URL("../README.md", import.meta.url);
writeFileSync(path, withCapabilities(readFileSync(path, "utf8")));
console.log("README capability tables written");
