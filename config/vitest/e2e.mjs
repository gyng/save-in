import { defineConfig } from "vitest/config";
import E2ETimingReporter from "../../scripts/e2e-timing-reporter.mjs";

// End-to-end suites drive real browsers: long timeouts, one browser at a
// time, and no coverage instrumentation. Run with `npm run e2e[:chrome|:firefox]`.
export default defineConfig({
  test: {
    globals: true,
    reporters: ["default", new E2ETimingReporter()],
    environment: "node",
    include: ["test/e2e/**/*.e2e.mjs"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 180_000,
    // E2E_RETRY belongs to the outer runner, which records a fresh-browser
    // suite retry in run.json. A hidden in-process retry would turn a flaky
    // case green without setting the workflow's flaked output. Callers can
    // still request an explicit diagnostic case retry with `--retry=1`.
    retry: 0,
  },
});
