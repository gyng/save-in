import fs from "node:fs";
import path from "node:path";

export default class E2ETimingReporter {
  /**
   * @param {ReadonlyArray<import("vitest/node").TestModule>} testModules
   * @param {ReadonlyArray<import("vitest/node").SerializedError>} unhandledErrors
   * @param {import("vitest/reporters").TestRunEndReason} reason
   */
  onTestRunEnd(testModules, unhandledErrors, reason) {
    const artifactDirectory = process.env.E2E_ARTIFACT_DIR;
    if (!artifactDirectory) return;

    for (const testModule of testModules) {
      const moduleId = testModule.moduleId;
      const browser = moduleId.includes("firefox.e2e")
        ? "firefox"
        : moduleId.includes("chrome.e2e")
          ? "chrome"
          : "unknown";
      const diagnostic = testModule.diagnostic();
      const tests = [...testModule.children.allTests()].map((testCase) => ({
        name: testCase.fullName,
        state: testCase.result().state,
        durationMs: testCase.diagnostic()?.duration ?? 0,
      }));
      const output = path.resolve(artifactDirectory, `timings-${browser}.json`);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            schemaVersion: 1,
            runId: process.env.E2E_RUN_ID,
            capturedAt: new Date().toISOString(),
            browser,
            success: reason === "passed",
            unhandledErrors: unhandledErrors.length,
            phases: {
              environmentSetupMs: diagnostic.environmentSetupDuration,
              prepareMs: diagnostic.prepareDuration,
              collectMs: diagnostic.collectDuration,
              setupMs: diagnostic.setupDuration,
              testsMs: diagnostic.duration,
            },
            tests,
          },
          null,
          2,
        ),
      );
    }
  }
}
