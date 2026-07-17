import fs from "node:fs";
import path from "node:path";
import timingUtils from "./e2e-timing-utils.js";

const { normalizeTimingModuleId, timingBrowserForModule } = timingUtils;

/** @param {string} artifactDirectory @param {string} browser */
const readBrowserVersion = (artifactDirectory, browser) => {
  const environmentFile = path.resolve(artifactDirectory, `${browser}-environment.json`);
  try {
    const environment = JSON.parse(fs.readFileSync(environmentFile, "utf8"));
    return environment?.browser === browser && typeof environment.version === "string"
      ? environment.version
      : undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

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
      const browser = timingBrowserForModule(testModule.moduleId);
      const modules = grouped.get(browser) ?? [];
      modules.push(testModule);
      grouped.set(browser, modules);
    }

    for (const [browser, modules] of grouped) {
      const browserVersion = readBrowserVersion(artifactDirectory, browser);
      const diagnostics = modules.map((testModule) => testModule.diagnostic());
      const tests = modules.flatMap((testModule) =>
        [...testModule.children.allTests()].map((testCase) => ({
          moduleId: normalizeTimingModuleId(testModule.moduleId),
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
            schemaVersion: 3,
            runId: process.env.E2E_RUN_ID,
            capturedAt: new Date().toISOString(),
            browser,
            ...(browserVersion ? { browserVersion } : {}),
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
