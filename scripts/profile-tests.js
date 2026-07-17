// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", `test-profile-${process.pid}.json`);
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const requestedLimit = Number.parseInt(process.env.PROFILE_LIMIT || "15", 10);
const limit = Number.isFinite(requestedLimit) ? Math.max(1, requestedLimit) : 15;
/** @typedef {{ name: string, duration: number }} ProfileAssertion */
/** @typedef {{ environmentSetupDuration: number, prepareDuration: number, collectDuration: number, setupDuration: number, duration: number, importDurations: Record<string, { selfTime?: number, totalTime?: number }> }} ProfileDiagnostic */
/** @typedef {{ name: string, diagnostic: ProfileDiagnostic, assertions: ProfileAssertion[] }} ProfileResult */
/** @typedef {{ name: string, duration: number }} ProfileRow */

fs.mkdirSync(path.dirname(output), { recursive: true });
const run = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    "config/vitest/unit.mjs",
    ...process.argv.slice(2),
    "--reporter=default",
    `--reporter=${path.join(root, "scripts", "test-profile-reporter.mjs")}`,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SAVE_IN_TEST_PROFILE_OUTPUT: output },
  },
);

try {
  if (!fs.existsSync(output)) process.exitCode = run.status ?? 1;
  else {
    /** @type {{ success?: boolean, files?: ProfileResult[] }} */
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    const files = report.files || [];
    const execution = files.map((result) => ({
      name: path.relative(root, result.name),
      duration: result.diagnostic.duration,
    }));
    const startup = files.map((result) => ({
      name: path.relative(root, result.name),
      duration:
        result.diagnostic.environmentSetupDuration +
        result.diagnostic.prepareDuration +
        result.diagnostic.collectDuration +
        result.diagnostic.setupDuration,
    }));
    const collection = files.map((result) => ({
      name: path.relative(root, result.name),
      duration: result.diagnostic.collectDuration,
    }));
    const assertions = files.flatMap((result) =>
      result.assertions.map((assertion) => ({
        name: `${path.relative(root, result.name)} > ${assertion.name}`,
        duration: assertion.duration,
      })),
    );
    /** @param {string} title @param {ProfileRow[]} rows */
    const printSlowest = (title, rows) => {
      process.stdout.write(`\n${title}\n`);
      rows
        .toSorted((a, b) => b.duration - a.duration)
        .slice(0, limit)
        .forEach(({ name, duration }) => {
          process.stdout.write(`${duration.toFixed(1).padStart(8)} ms  ${name}\n`);
        });
    };
    printSlowest("Slowest test files (tests and hooks)", execution);
    printSlowest("Slowest test-file startup (environment, setup, and collection)", startup);
    printSlowest("Slowest test-file collection/import", collection);
    printSlowest("Slowest assertions", assertions);
    process.exitCode = run.status ?? (report.success ? 0 : 1);
  }
} finally {
  fs.rmSync(output, { force: true });
}
