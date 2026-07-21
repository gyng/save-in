// @ts-check

const fs = require("node:fs");
const path = require("node:path");
const { walkFiles } = require("./lib/walk-files.js");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "config", "vitest", "base.mjs");
const sourceRoot = path.join(root, "src");
// Coverage markers hide source from the denominator. Keep the ceiling at zero
// so the four 100% thresholds describe the entire production source tree.
const ignoreCeiling = 0;

const errors = [];
const config = fs.readFileSync(configPath, "utf8");
for (const metric of ["statements", "branches", "functions", "lines"]) {
  if (!new RegExp(`\\b${metric}:\\s*100\\b`).test(config)) {
    errors.push(`config/vitest/base.mjs: coverage threshold ${metric} must remain 100`);
  }
}

/** @type {string[]} */
const ignoreLocations = [];
for (const file of walkFiles(sourceRoot).filter((candidate) => candidate.endsWith(".ts"))) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes("v8 ignore")) return;
    ignoreLocations.push(`${path.relative(root, file)}:${index + 1}`);
  });
}

if (ignoreLocations.length > ignoreCeiling) {
  errors.push(
    `Source coverage ignores increased to ${ignoreLocations.length}; ceiling is ${ignoreCeiling}. ` +
      `Cover the branch behavior or remove the unreachable source body. Locations: ${ignoreLocations.join(", ")}`,
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Coverage policy keeps four full-source 100% thresholds and no coverage ignores.");
}
