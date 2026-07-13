import { defineConfig } from "vitest/config";

const configuredTime = Number.parseInt(process.env.FUZZ_TIME_MS ?? "", 10);
const fuzzTimeMs =
  Number.isSafeInteger(configuredTime) && configuredTime > 0 ? configuredTime : 10_000;

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/fuzz/**/*.fuzz.ts"],
    maxWorkers: 1,
    testTimeout: fuzzTimeMs + 15_000,
  },
});
