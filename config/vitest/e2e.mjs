import { defineConfig } from "vitest/config";

// End-to-end suites drive real browsers: long timeouts, one browser at a
// time, and no coverage instrumentation. Run with `npm run e2e[:chrome|:firefox]`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/e2e/**/*.e2e.mjs"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 180_000,
    retry: Math.max(0, Number.parseInt(process.env.E2E_RETRY || "0", 10) || 0),
  },
});
