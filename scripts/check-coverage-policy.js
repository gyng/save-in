// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { walkFiles } = require("./lib/walk-files.js");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "config", "vitest", "base.mjs");
const sourceRoot = path.join(root, "src");
// Reviewed ceiling after the 4.2 parser/finalization/data-URL cleanup removed ten
// obsolete ignores. New ignores require an explicit rationale and a deliberate
// ceiling update so uncovered branches cannot accumulate silently.
const ignoreCeiling = 74;

const errors = [];
const config = fs.readFileSync(configPath, "utf8");
for (const metric of ["statements", "branches", "functions", "lines"]) {
  if (!new RegExp(`\\b${metric}:\\s*100\\b`).test(config)) {
    errors.push(`config/vitest/base.mjs: coverage threshold ${metric} must remain 100`);
  }
}

const ignoreLocations = [];
for (const file of walkFiles(sourceRoot).filter((candidate) => candidate.endsWith(".ts"))) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes("v8 ignore")) return;
    ignoreLocations.push(`${path.relative(root, file)}:${index + 1}`);
    if (!/v8 ignore (?:next|start|stop) -- \S/.test(line)) {
      errors.push(`${path.relative(root, file)}:${index + 1}: coverage ignore needs a rationale`);
    }
  });
}

if (ignoreLocations.length > ignoreCeiling) {
  errors.push(
    `Source coverage ignores increased to ${ignoreLocations.length}; ceiling is ${ignoreCeiling}. ` +
      "Cover the branch behavior or review and update the explicit budget.",
  );
} else if (ignoreLocations.length < ignoreCeiling) {
  errors.push(
    `Source coverage ignores fell to ${ignoreLocations.length}; lower the recorded ceiling from ` +
      `${ignoreCeiling} to preserve the improvement.`,
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Coverage policy keeps four 100% thresholds and ${ignoreCeiling} reviewed ignores.`);
}
