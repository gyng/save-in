// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", `test-profile-${process.pid}.json`);
const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
const requestedLimit = Number.parseInt(process.env.PROFILE_LIMIT || "15", 10);
const limit = Number.isFinite(requestedLimit) ? Math.max(1, requestedLimit) : 15;
/** @typedef {{ duration?: number, fullName: string }} ProfileAssertion */
/** @typedef {{ name: string, assertionResults?: ProfileAssertion[] }} ProfileResult */
/** @typedef {{ name: string, duration: number }} ProfileRow */

fs.mkdirSync(path.dirname(output), { recursive: true });
const run = spawnSync(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    "vitest.unit.config.mjs",
    ...process.argv.slice(2),
    "--reporter=json",
    `--outputFile=${output}`,
  ],
  { cwd: root, stdio: "inherit" },
);

try {
  if (!fs.existsSync(output)) process.exitCode = run.status ?? 1;
  else {
    /** @type {{ success?: boolean, testResults?: ProfileResult[] }} */
    const report = JSON.parse(fs.readFileSync(output, "utf8"));
    const files = (report.testResults || []).map((result) => ({
      name: path.relative(root, result.name),
      duration: (result.assertionResults || []).reduce(
        (total, assertion) => total + (assertion.duration || 0),
        0,
      ),
    }));
    const assertions = (report.testResults || []).flatMap((result) =>
      (result.assertionResults || []).map((assertion) => ({
        name: `${path.relative(root, result.name)} > ${assertion.fullName}`,
        duration: assertion.duration || 0,
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
    printSlowest("Slowest test files (summed assertion time)", files);
    printSlowest("Slowest assertions", assertions);
    process.exitCode = run.status ?? (report.success ? 0 : 1);
  }
} finally {
  fs.rmSync(output, { force: true });
}
