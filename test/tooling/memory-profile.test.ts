import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseMemorySample } = require("../../scripts/profile-memory.js") as {
  parseMemorySample: (
    outputText: string,
    expectedScenario: string,
  ) => {
    scenario: string;
    fixtureCount: number;
    retainedCount: number;
    retainedDetailCount: number;
    baselineHeapBytes: number;
    uncollectedGrowthBytes: number;
    retainedGrowthBytes: number;
    rssBytes: number;
    durationMs: number;
  };
};

const validSample = {
  scenario: "source-compacted",
  fixtureCount: 100_000,
  retainedCount: 1,
  retainedDetailCount: 100_000,
  baselineHeapBytes: 10,
  uncollectedGrowthBytes: 20,
  retainedGrowthBytes: 5,
  rssBytes: 30,
  durationMs: 1.5,
};
const nonFiniteSample = JSON.stringify(validSample).replace(
  '"retainedGrowthBytes":5',
  '"retainedGrowthBytes":1e999',
);

test("accepts a complete finite memory worker sample", () => {
  expect(parseMemorySample(JSON.stringify(validSample), "source-compacted")).toEqual(validSample);
});

test.each([
  ["not JSON", "invalid JSON"],
  [JSON.stringify([]), "non-object"],
  [JSON.stringify({ ...validSample, scenario: "source-legacy" }), "wrong scenario"],
  [JSON.stringify({ ...validSample, retainedCount: -1 }), "invalid retainedCount"],
  [JSON.stringify({ ...validSample, retainedGrowthBytes: null }), "invalid retainedGrowthBytes"],
  [nonFiniteSample, "invalid retainedGrowthBytes"],
  [JSON.stringify({ ...validSample, durationMs: "fast" }), "invalid durationMs"],
])("rejects an unusable worker sample", (sample, message) => {
  expect(() => parseMemorySample(sample, "source-compacted")).toThrow(message);
});
