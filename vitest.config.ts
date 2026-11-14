import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "client",
          include: ["packages/client/test/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "autocomplete",
          include: ["packages/autocomplete/test/**/*.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
      },
    ],
  },
});
