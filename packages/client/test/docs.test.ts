/// <reference types="node" />
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { withCapabilities } from "../scripts/capabilities.ts";

// The formatter pads the tables, so the two are compared without their padding.
const plain = (markdown: string): string =>
  markdown
    .replace(/[ \t]+/g, " ")
    .replace(/-{3,}/g, "---")
    .replace(/\n{2,}/g, "\n");

it("the README's capability tables match the adapters", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  // Out of date? Run `bun run docs:capabilities`.
  expect(plain(withCapabilities(readme))).toBe(plain(readme));
});
