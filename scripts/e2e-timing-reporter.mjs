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

    /** @type {Map<string, import("vitest/node").TestModule[]>} */
    const grouped = new Map();
    for (const testModule of testModules) {
      const moduleId = testModule.moduleId;
      const browser = moduleId.includes("firefox.e2e")
        ? "firefox"
        : moduleId.includes("chrome.e2e")
          ? "chrome"
          : "unknown";
      const modules = grouped.get(browser) ?? [];
      modules.push(testModule);
      grouped.set(browser, modules);
    }

    for (const [browser, modules] of grouped) {
      const diagnostics = modules.map((testModule) => testModule.diagnostic());
      const tests = modules.flatMap((testModule) =>
        [...testModule.children.allTests()].map((testCase) => ({
          moduleId: testModule.moduleId,
          name: testCase.fullName,
          state: testCase.result().state,
          durationMs: testCase.diagnostic()?.duration ?? 0,
        })),
      );
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
              environmentSetupMs: diagnostics.reduce(
                (sum, diagnostic) => sum + (diagnostic.environmentSetupDuration ?? 0),
                0,
              ),
              prepareMs: diagnostics.reduce(
                (sum, diagnostic) => sum + (diagnostic.prepareDuration ?? 0),
                0,
              ),
              collectMs: diagnostics.reduce(
                (sum, diagnostic) => sum + (diagnostic.collectDuration ?? 0),
                0,
              ),
              setupMs: diagnostics.reduce(
                (sum, diagnostic) => sum + (diagnostic.setupDuration ?? 0),
                0,
              ),
              testsMs: diagnostics.reduce((sum, diagnostic) => sum + (diagnostic.duration ?? 0), 0),
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
