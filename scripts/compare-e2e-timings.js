// @ts-check

const fs = require("node:fs");
const path = require("node:path");

/** @typedef {{name: string, durationMs: number}} TimingCase */
/** @typedef {{browser: string, tests: TimingCase[]}} TimingReport */

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
      typeof test.durationMs !== "number" ||
      !Number.isFinite(test.durationMs)
    ) {
      throw new Error(`Invalid E2E timing case: ${file}`);
    }
    return { name: test.name, durationMs: test.durationMs };
  });
  return /** @type {TimingReport} */ ({ browser: value.browser, tests });
};

/** @param {string} target */
const reportFiles = (target) => {
  const absolute = path.resolve(target);
  if (fs.statSync(absolute).isFile()) return [absolute];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^timings-.*\.json$/.test(entry.name))
    .map((entry) => path.join(absolute, entry.name))
    .toSorted();
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
  const baseline = new Map();
  for (const report of baselineReports) {
    for (const test of report.tests)
      baseline.set(`${report.browser}\0${test.name}`, test.durationMs);
  }
  return currentReports.flatMap((report) =>
    report.tests.flatMap((test) => {
      const baselineMs = baseline.get(`${report.browser}\0${test.name}`);
      if (baselineMs === undefined || baselineMs <= 0 || test.durationMs <= baselineMs * 1.25) {
        return [];
      }
      const deltaMs = test.durationMs - baselineMs;
      const ratio = test.durationMs / baselineMs;
      return [
        {
          browser: report.browser,
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
  const regressions = compareTimingReports(
    readReports(options.baseline),
    readReports(options.current),
  );
  if (!regressions.length) {
    console.log("No per-case E2E timing regressions above 25%.");
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

module.exports = { compareTimingReports, decodeReport, parseArguments };
