import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("does not ship a redundant standalone click-to-copy bundle", () => {
  const config = readFileSync(resolve("rolldown.config.mjs"), "utf8");
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");

  expect(config).not.toContain('file: "dist/bundled/clicktocopy.js"');
  expect(stage).toContain('f === "clicktocopy.js"');
});

test("isolates E2E bundles from store and dev builds", () => {
  const config = readFileSync(resolve("rolldown.config.mjs"), "utf8");
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const packageJson = readFileSync(resolve("package.json"), "utf8");

  expect(config).toContain('process.env.SAVE_IN_E2E === "1" ? "dist/bundled-e2e"');
  expect(stage).toContain('expectE2EBridge ? "bundled-pkg-e2e" : "bundled-pkg"');
  expect(stage).toContain('targetBrowser === "firefox" ? "-firefox" : ""');
  expect(packageJson).toContain("EXT_DIR=dist/bundled-pkg-e2e");
  expect(packageJson).toContain("EXT_DIR=dist/bundled-pkg-e2e-firefox");
});

test("stages browser-specific private-browsing modes", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const packageJson = readFileSync(resolve("package.json"), "utf8");

  expect(manifest.incognito).toBe("spanning");
  expect(stage).toContain('targetBrowser === "firefox" ? "spanning" : "split"');
  expect(packageJson).toContain('"build:bundled": "npm run build:chrome && npm run build:firefox"');
});
