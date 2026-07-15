import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareTimingReports, timingEnvironmentMismatches } =
  require("../../scripts/compare-e2e-timings.js") as {
    compareTimingReports: (
      baseline: Array<{
        browser: string;
        browserVersion?: string;
        success?: boolean;
        tests: Array<{ moduleId?: string; name: string; durationMs: number }>;
      }>,
      current: Array<{
        browser: string;
        browserVersion?: string;
        success?: boolean;
        tests: Array<{ moduleId?: string; name: string; durationMs: number }>;
      }>,
    ) => Array<{ name: string; severity: "advisory" | "severe" }>;
    timingEnvironmentMismatches: (
      baseline: Array<{ browser: string; browserVersion?: string; tests: unknown[] }>,
      current: Array<{ browser: string; browserVersion?: string; tests: unknown[] }>,
    ) => Array<{ browser: string; baselineVersion: string; currentVersion: string }>;
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

test("keeps duplicate test names distinct by normalized module identity", () => {
  const baseline = [
    {
      browser: "chrome",
      tests: [
        {
          moduleId: "/old/work/test/e2e/chrome/downloads.e2e.mjs",
          name: "saves",
          durationMs: 1000,
        },
        { moduleId: "/old/work/test/e2e/chrome/menus.e2e.mjs", name: "saves", durationMs: 4000 },
      ],
    },
  ];
  const current = [
    {
      browser: "chrome",
      tests: [
        {
          moduleId: "/new/work/test/e2e/chrome/downloads.e2e.mjs",
          name: "saves",
          durationMs: 1400,
        },
        { moduleId: "/new/work/test/e2e/chrome/menus.e2e.mjs", name: "saves", durationMs: 4100 },
      ],
    },
  ];

  expect(compareTimingReports(baseline, current)).toMatchObject([
    { moduleId: "test/e2e/chrome/downloads.e2e.mjs", name: "saves", severity: "advisory" },
  ]);
});

test("rejects ambiguous duplicate identities instead of overwriting a baseline", () => {
  expect(() =>
    compareTimingReports(
      [
        {
          browser: "firefox",
          tests: [
            { name: "duplicate", durationMs: 100 },
            { name: "duplicate", durationMs: 200 },
          ],
        },
      ],
      [],
    ),
  ).toThrow("Duplicate baseline E2E timing case");
});

test("keeps a large percentage increase advisory when its absolute cost is below two seconds", () => {
  expect(
    compareTimingReports(
      [{ browser: "firefox", tests: [{ name: "fast", durationMs: 100 }] }],
      [{ browser: "firefox", tests: [{ name: "fast", durationMs: 400 }] }],
    ),
  ).toMatchObject([{ name: "fast", severity: "advisory" }]);
});

test("skips cross-version comparisons and reports why", () => {
  const baseline = [
    {
      browser: "chrome",
      browserVersion: "Google Chrome 149.0.0.0",
      tests: [{ name: "saves", durationMs: 1000 }],
    },
  ];
  const current = [
    {
      browser: "chrome",
      browserVersion: "Google Chrome 150.0.0.0",
      tests: [{ name: "saves", durationMs: 2000 }],
    },
  ];

  expect(compareTimingReports(baseline, current)).toEqual([]);
  expect(timingEnvironmentMismatches(baseline, current)).toEqual([
    {
      browser: "chrome",
      baselineVersion: "Google Chrome 149.0.0.0",
      currentVersion: "Google Chrome 150.0.0.0",
    },
  ]);
});

test("refuses to present a failed run as performance evidence", () => {
  expect(() =>
    compareTimingReports(
      [{ browser: "firefox", tests: [{ name: "saves", durationMs: 1000 }] }],
      [
        {
          browser: "firefox",
          success: false,
          tests: [{ name: "saves", durationMs: 2000 }],
        },
      ],
    ),
  ).toThrow("Cannot compare an unsuccessful E2E timing report");
});
