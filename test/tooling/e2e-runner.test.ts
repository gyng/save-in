import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { finalizeRunMetadata, parseArguments } = require("../../scripts/e2e-parallel.js") as {
  finalizeRunMetadata: (
    metadata: Record<string, unknown>,
    outcome: {
      codes: number[];
      cleanupErrors: unknown[];
      interruptedSignal?: NodeJS.Signals;
      runError?: unknown;
      finishedAt?: Date;
    },
  ) => Record<string, unknown>;
  parseArguments: (argv: string[]) => {
    browser: "all" | "chrome" | "firefox";
    serial: boolean;
    headed: boolean;
    vitestArgs: string[];
  };
};

test("parses harness options without swallowing Vitest arguments", () => {
  expect(
    parseArguments([
      "--browser=firefox",
      "--serial",
      "--headed",
      "--test-name",
      "download pipeline",
      "--",
      "--retry=1",
    ]),
  ).toEqual({
    browser: "firefox",
    serial: true,
    headed: true,
    vitestArgs: ["-t", "download pipeline", "--retry=1"],
  });
  expect(() => parseArguments(["--browser", "safari"])).toThrow("Unsupported E2E browser");
  expect(() => parseArguments(["--test-name"])).toThrow("requires a pattern");
});

test("records a terminal outcome for successful and failed runs", () => {
  const started = { runId: "run-1", startedAt: "2026-01-01T00:00:00.000Z" };
  const finishedAt = new Date("2026-01-01T00:00:03.250Z");

  expect(
    finalizeRunMetadata(started, { codes: [0, 0], cleanupErrors: [], finishedAt }),
  ).toMatchObject({
    status: "passed",
    finishedAt: "2026-01-01T00:00:03.250Z",
    durationMs: 3250,
    exitCodes: [0, 0],
  });
  expect(
    finalizeRunMetadata(started, {
      codes: [1],
      cleanupErrors: [new Error("profile remained")],
      runError: new Error("staging failed"),
      finishedAt,
    }),
  ).toMatchObject({
    status: "failed",
    exitCodes: [1],
    failure: expect.stringContaining("staging failed"),
    cleanupErrors: [expect.stringContaining("profile remained")],
  });
});

test("distinguishes an interrupted run from an ordinary failure", () => {
  expect(
    finalizeRunMetadata(
      { startedAt: "2026-01-01T00:00:00.000Z" },
      {
        codes: [1],
        cleanupErrors: [],
        interruptedSignal: "SIGTERM",
        finishedAt: new Date("2026-01-01T00:00:01.000Z"),
      },
    ),
  ).toMatchObject({
    status: "interrupted",
    interruptedSignal: "SIGTERM",
    durationMs: 1000,
  });
});
