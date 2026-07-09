import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    setupFiles: ["./test/vitest.setup.mjs"],
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      exclude: [
        // vendored libraries
        "src/vendor/**",
        "src/options/vendor/**",
        // service worker bootstrap (importScripts shim): exercised by e2e
        "src/background.js",
        // options page scripts run top-level against the real options.html
        // DOM: exercised by the e2e options-page checks
        "src/options/**",
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
