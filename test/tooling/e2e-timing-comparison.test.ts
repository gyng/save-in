import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareTimingReports } = require("../../scripts/compare-e2e-timings.js") as {
  compareTimingReports: (
    baseline: Array<{ browser: string; tests: Array<{ name: string; durationMs: number }> }>,
    current: Array<{ browser: string; tests: Array<{ name: string; durationMs: number }> }>,
  ) => Array<{ name: string; severity: "advisory" | "severe" }>;
};

test("classifies advisory and severe per-case timing regressions", () => {
  const baseline = [
    {
      browser: "chrome",
      tests: [
        { name: "small drift", durationMs: 1000 },
        { name: "advisory", durationMs: 1000 },
        { name: "severe", durationMs: 4000 },
      ],
    },
  ];
  const current = [
    {
      browser: "chrome",
      tests: [
        { name: "small drift", durationMs: 1200 },
        { name: "advisory", durationMs: 1400 },
        { name: "severe", durationMs: 6100 },
      ],
    },
  ];

  expect(compareTimingReports(baseline, current)).toMatchObject([
    { name: "advisory", severity: "advisory" },
    { name: "severe", severity: "severe" },
  ]);
});

test("keeps a large percentage increase advisory when its absolute cost is below two seconds", () => {
  expect(
    compareTimingReports(
      [{ browser: "firefox", tests: [{ name: "fast", durationMs: 100 }] }],
      [{ browser: "firefox", tests: [{ name: "fast", durationMs: 400 }] }],
    ),
  ).toMatchObject([{ name: "fast", severity: "advisory" }]);
});
