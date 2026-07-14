import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export const resolveMaxWorkers = ({
  requested = process.env.TEST_MAX_WORKERS,
  ci = process.env.CI,
  cores = availableParallelism(),
} = {}) => {
  const requestedWorkers = Number.parseInt(requested ?? "", 10);
  if (Number.isFinite(requestedWorkers)) return Math.max(1, requestedWorkers);
  return ci === "true" || ci === "1" ? Math.max(1, cores) : Math.max(1, cores - 4);
};

const maxWorkers = resolveMaxWorkers();

export default defineConfig({
  test: {
    // jsdom workers are CPU- and memory-heavy. Leave four logical CPUs for the
    // local desktop; disposable CI runners use every available CPU.
    maxWorkers,
    globals: true,
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    setupFiles: ["./test/support/vitest.setup.ts"],
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // vendored libraries
        "src/vendor/**",
        // Rolldown bundle entries are exercised through the real extension
        // lifecycle in e2e.
        "src/entries/**",
        // Test-only control surface imported exclusively by background.e2e.ts.
        "src/background/e2e-command.ts",
        // Chrome offscreen-document bootstrap (message listener doing
        // fetch/createObjectURL/crypto.subtle in a separate document context):
        // exercised by the Chrome e2e sha256/offscreen path
        "src/offscreen.ts",
        // The options composition root runs top-level against the real document;
        // pure models and controllers remain visible to unit coverage.
        "src/options/options.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
