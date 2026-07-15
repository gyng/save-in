import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestModule } from "vitest/node";
import E2ETimingReporter from "../../scripts/e2e-timing-reporter.mjs";

const originalArtifactDirectory = process.env.E2E_ARTIFACT_DIR;
const originalRunId = process.env.E2E_RUN_ID;

afterEach(() => {
  if (originalArtifactDirectory === undefined) delete process.env.E2E_ARTIFACT_DIR;
  else process.env.E2E_ARTIFACT_DIR = originalArtifactDirectory;
  if (originalRunId === undefined) delete process.env.E2E_RUN_ID;
  else process.env.E2E_RUN_ID = originalRunId;
});

test("writes compact per-browser timing telemetry", () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), "save-in-e2e-timings-"));
  process.env.E2E_ARTIFACT_DIR = artifactDirectory;
  process.env.E2E_RUN_ID = "run-123";
  const testModule = {
    moduleId: "/repo/test/e2e/chrome.e2e.mjs",
    diagnostic: () => ({
      environmentSetupDuration: 10,
      prepareDuration: 20,
      collectDuration: 30,
      setupDuration: 40,
      duration: 50,
    }),
    children: {
      allTests: () => [
        {
          fullName: "Chrome E2E saves a download",
          result: () => ({ state: "passed" }),
          diagnostic: () => ({ duration: 123 }),
        },
      ],
    },
  } as unknown as TestModule;

  try {
    new E2ETimingReporter().onTestRunEnd([testModule], [], "passed");

    const report = JSON.parse(
      readFileSync(join(artifactDirectory, "timings-chrome.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(report).toMatchObject({
      schemaVersion: 1,
      runId: "run-123",
      browser: "chrome",
      success: true,
      unhandledErrors: 0,
      phases: {
        environmentSetupMs: 10,
        prepareMs: 20,
        collectMs: 30,
        setupMs: 40,
        testsMs: 50,
      },
      tests: [{ name: "Chrome E2E saves a download", state: "passed", durationMs: 123 }],
    });
    expect(report.capturedAt).toEqual(expect.any(String));
  } finally {
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});

test("does nothing outside an E2E artifact run", () => {
  delete process.env.E2E_ARTIFACT_DIR;

  expect(() => new E2ETimingReporter().onTestRunEnd([], [], "passed")).not.toThrow();
});
