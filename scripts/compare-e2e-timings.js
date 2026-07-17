// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { normalizeTimingModuleId, timingCaseKey } = require("./e2e-timing-utils.js");

/** @typedef {{moduleId?: string, name: string, durationMs: number}} TimingCase */
/** @typedef {{browser: string, browserVersion?: string, success?: boolean, tests: TimingCase[]}} TimingReport */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value @param {string} file */
const decodeReport = (value, file) => {
  if (!isRecord(value) || typeof value.browser !== "string" || !Array.isArray(value.tests)) {
    throw new Error(`Invalid E2E timing report: ${file}`);
  }
  const tests = value.tests.map((test) => {
    if (
      !isRecord(test) ||
      typeof test.name !== "string" ||
      (test.moduleId !== undefined && typeof test.moduleId !== "string") ||
      typeof test.durationMs !== "number" ||
      !Number.isFinite(test.durationMs)
    ) {
      throw new Error(`Invalid E2E timing case: ${file}`);
    }
    return {
      ...(typeof test.moduleId === "string"
        ? { moduleId: normalizeTimingModuleId(test.moduleId) }
        : {}),
      name: test.name,
      durationMs: test.durationMs,
    };
  });
  if (value.browserVersion !== undefined && typeof value.browserVersion !== "string") {
    throw new Error(`Invalid E2E timing browser version: ${file}`);
  }
  if (value.success !== undefined && typeof value.success !== "boolean") {
    throw new Error(`Invalid E2E timing success state: ${file}`);
  }
  return /** @type {TimingReport} */ ({
    browser: value.browser,
    ...(typeof value.browserVersion === "string" ? { browserVersion: value.browserVersion } : {}),
    ...(typeof value.success === "boolean" ? { success: value.success } : {}),
    tests,
  });
};

/** @param {string} target */
const reportFiles = (target) => {
  const absolute = path.resolve(target);
  if (fs.statSync(absolute).isFile()) return [absolute];
  /** @param {string} directory @returns {string[]} */
  const visit = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? visit(entryPath)
        : entry.isFile() && /^timings-.*\.json$/.test(entry.name)
          ? [entryPath]
          : [];
    });
  return visit(absolute).toSorted();
};

/** @param {string} target */
const readReports = (target) =>
  reportFiles(target).map((file) =>
    decodeReport(/** @type {unknown} */ (JSON.parse(fs.readFileSync(file, "utf8"))), file),
  );

/**
 * @param {TimingReport[]} baselineReports
 * @param {TimingReport[]} currentReports
 */
const compareTimingReports = (baselineReports, currentReports) => {
  if ([...baselineReports, ...currentReports].some((report) => report.success === false)) {
    throw new Error("Cannot compare an unsuccessful E2E timing report");
  }
  const baseline = new Map();
  const baselineByName = new Map();
  for (const report of baselineReports) {
    for (const test of report.tests) {
      const identity = {
        browser: report.browser,
        ...(test.moduleId ? { moduleId: normalizeTimingModuleId(test.moduleId) } : {}),
        name: test.name,
      };
      const key = timingCaseKey(identity);
      if (baseline.has(key)) throw new Error(`Duplicate baseline E2E timing case: ${key}`);
      baseline.set(key, { durationMs: test.durationMs, browserVersion: report.browserVersion });
      const nameKey = `${report.browser}\0${test.name}`;
      const candidates = baselineByName.get(nameKey) ?? [];
      candidates.push({
        ...identity,
        durationMs: test.durationMs,
        browserVersion: report.browserVersion,
      });
      baselineByName.set(nameKey, candidates);
    }
  }
  const currentKeys = new Set();
  for (const report of currentReports) {
    for (const test of report.tests) {
      const key = timingCaseKey({
        browser: report.browser,
        ...(test.moduleId ? { moduleId: normalizeTimingModuleId(test.moduleId) } : {}),
        name: test.name,
      });
      if (currentKeys.has(key)) throw new Error(`Duplicate current E2E timing case: ${key}`);
      currentKeys.add(key);
    }
  }
  return currentReports.flatMap((report) =>
    report.tests.flatMap((test) => {
      const identity = {
        browser: report.browser,
        ...(test.moduleId ? { moduleId: normalizeTimingModuleId(test.moduleId) } : {}),
        name: test.name,
      };
      let baselineCase = baseline.get(timingCaseKey(identity));
      if (baselineCase === undefined) {
        const candidates = baselineByName.get(`${report.browser}\0${test.name}`) ?? [];
        if (candidates.length === 1 && (!identity.moduleId || !candidates[0]?.moduleId)) {
          baselineCase = candidates[0];
        }
      }
      if (
        baselineCase?.browserVersion &&
        report.browserVersion &&
        baselineCase.browserVersion !== report.browserVersion
      ) {
        return [];
      }
      const baselineMs = baselineCase?.durationMs;
      if (baselineMs === undefined || baselineMs <= 0 || test.durationMs <= baselineMs * 1.25) {
        return [];
      }
      const deltaMs = test.durationMs - baselineMs;
      const ratio = test.durationMs / baselineMs;
      return [
        {
          browser: report.browser,
          moduleId: identity.moduleId,
          name: test.name,
          baselineMs,
          currentMs: test.durationMs,
          deltaMs,
          ratio,
          severity: ratio > 1.5 && deltaMs >= 2000 ? "severe" : "advisory",
        },
      ];
    }),
  );
};

/**
 * @param {TimingReport[]} baselineReports
 * @param {TimingReport[]} currentReports
 */
const timingEnvironmentMismatches = (baselineReports, currentReports) => {
  const baselineVersions = new Map(
    baselineReports.flatMap((report) =>
      report.browserVersion ? [[report.browser, report.browserVersion]] : [],
    ),
  );
  return currentReports.flatMap((report) => {
    const baselineVersion = baselineVersions.get(report.browser);
    return baselineVersion && report.browserVersion && baselineVersion !== report.browserVersion
      ? [
          {
            browser: report.browser,
            baselineVersion,
            currentVersion: report.browserVersion,
          },
        ]
      : [];
  });
};

/** @param {string[]} argv */
const parseArguments = (argv) => {
  let baseline;
  let current;
  let enforce = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--baseline") baseline = argv[++index];
    else if (argument === "--current") current = argv[++index];
    else if (argument === "--enforce") enforce = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!baseline || !current) {
    throw new Error("Usage: compare-e2e-timings --baseline <file-or-dir> --current <file-or-dir>");
  }
  return { baseline, current, enforce };
};

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const baselineReports = readReports(options.baseline);
  const currentReports = readReports(options.current);
  const mismatches = timingEnvironmentMismatches(baselineReports, currentReports);
  for (const mismatch of mismatches) {
    console.log(
      `SKIPPED ${mismatch.browser}: browser changed from ${mismatch.baselineVersion} to ` +
        `${mismatch.currentVersion}.`,
    );
  }
  const regressions = compareTimingReports(baselineReports, currentReports);
  if (!regressions.length) {
    console.log(
      mismatches.length
        ? "No per-case E2E timing regressions above 25% among comparable browsers."
        : "No per-case E2E timing regressions above 25%.",
    );
    return;
  }
  for (const regression of regressions) {
    console.log(
      `${regression.severity.toUpperCase()} ${regression.browser}: ${regression.name} ` +
        `${Math.round(regression.baselineMs)}ms -> ${Math.round(regression.currentMs)}ms ` +
        `(+${Math.round((regression.ratio - 1) * 100)}%, +${Math.round(regression.deltaMs)}ms)`,
    );
  }
  if (options.enforce && regressions.some(({ severity }) => severity === "severe")) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  compareTimingReports,
  decodeReport,
  parseArguments,
  readReports,
  timingEnvironmentMismatches,
};
