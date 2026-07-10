// The background file list exists twice by necessity: manifest.json
// background.scripts (Firefox event page) and src/background.js
// importScripts(...) (Chrome service worker). There is no build step to
// generate one from the other, so this check fails the lint when they drift.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const manifestList = manifest.background.scripts;

const backgroundJs = fs.readFileSync(path.join(ROOT, "src", "background.js"), "utf8");
const importScriptsMatch = backgroundJs.match(/importScripts\(([\s\S]*?)\)/);
if (!importScriptsMatch) {
  console.error("check-background-scripts: no importScripts(...) call found in src/background.js");
  process.exit(1);
}
// importScripts paths are relative to src/, the manifest's to the root
const workerList = [...importScriptsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => `src/${m[1]}`);

// background.js itself is the worker entry, never in its own list
const expected = manifestList.filter((f) => f !== "src/background.js");

const same = expected.length === workerList.length && expected.every((f, i) => f === workerList[i]);

if (!same) {
  console.error("check-background-scripts: the background script lists have drifted.\n");
  console.error("manifest.json background.scripts:");
  expected.forEach((f) => console.error(`  ${f}`));
  console.error("\nsrc/background.js importScripts:");
  workerList.forEach((f) => console.error(`  ${f}`));
  console.error("\nKeep both lists identical (same files, same order).");
  process.exit(1);
}

const missing = expected.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missing.length > 0) {
  console.error(`check-background-scripts: listed files missing on disk: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`check-background-scripts: OK (${expected.length} files, lists in sync)`);
