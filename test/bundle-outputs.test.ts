import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("does not ship a redundant standalone click-to-copy bundle", () => {
  const config = readFileSync(resolve("rolldown.config.mjs"), "utf8");
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");

  expect(config).not.toContain('file: "dist/bundled/clicktocopy.js"');
  expect(stage).not.toContain('"clicktocopy.js"');
});

test("cleans bundle output and stages only declared rolldown artifacts", () => {
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const cleanup = stage.indexOf("fs.rmSync(bundleDir");
  const bundle = stage.indexOf("execFileSync(");

  expect(cleanup).toBeGreaterThan(-1);
  expect(cleanup).toBeLessThan(bundle);
  expect(stage).toContain("const bundleFiles = [");
  expect(stage).toContain("for (const f of bundleFiles)");
  expect(stage).not.toContain("for (const f of fs.readdirSync(bundleDir))");
});

test("ships a self-verifying Mozilla source attachment", () => {
  const sourceBuild = readFileSync(resolve("scripts/build-source-package.js"), "utf8");
  const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

  for (const required of [
    '"e2e"',
    '"CHANGELOG.md"',
    '"tsconfig.chrome.json"',
    '"tsconfig.worker.json"',
    '"tsconfig.tools.json"',
    '"tsconfig.tools-legacy.json"',
    '"tsconfig.test.json"',
    '"!.gitignore"',
    '"!.oxlintrc.json"',
    '"!.oxfmtrc.json"',
    '"!.github/**/*"',
    "verifyArchive",
    "canonicalizeZip",
    '"src/options/version.json"',
  ]) {
    expect(sourceBuild).toContain(required);
  }
  expect(ci).toContain("npm run build:source");
});

test("creates stable archives without generated checkout metadata", () => {
  const runtimeBuild = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const runtimePackage = readFileSync(resolve("scripts/package-runtime.js"), "utf8");
  const sourceBuild = readFileSync(resolve("scripts/build-source-package.js"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

  expect(runtimeBuild).toContain("assertPackageVersion(root)");
  expect(runtimeBuild).toContain('"src/options/version.json"');
  expect(runtimeBuild).not.toContain("writeVersion");
  expect(runtimePackage).toContain("canonicalizeZip");
  expect(runtimePackage).toContain("assertPackageVersion(root)");
  expect(runtimePackage).toContain('"--no-config-discovery"');
  expect(runtimePackage).toContain('"save-in-{version}.zip"');
  expect(sourceBuild).toContain("assertPackageVersion(root)");
  expect(sourceBuild).not.toContain("writeVersion");
  expect(packageJson.scripts["build:bundled"]).toContain("scripts/package-runtime.js");
});

test("isolates E2E bundles from store and dev builds", () => {
  const config = readFileSync(resolve("rolldown.config.mjs"), "utf8");
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const packageJson = readFileSync(resolve("package.json"), "utf8");

  expect(config).toContain('process.env.SAVE_IN_BUILD_MODE === "e2e"');
  expect(config).not.toContain("SAVE_IN_E2E");
  expect(stage).toContain('expectE2EControl ? "bundled-pkg-e2e" : "bundled-pkg"');
  expect(stage).toContain("parseBuildMode(process.argv.slice(2))");
  expect(packageJson).toContain("build-bundled.js --mode=e2e");
  expect(packageJson).toContain("EXT_DIR=dist/bundled-pkg-e2e");
});

test("uses one spanning package for both stores", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const packageJson = readFileSync(resolve("package.json"), "utf8");
  const runtimePackage = readFileSync(resolve("scripts/package-runtime.js"), "utf8");

  expect(manifest.incognito).toBe("spanning");
  expect(stage).not.toContain("SAVE_IN_BROWSER");
  expect(stage).toContain('"save-in-chrome-mv3.zip"');
  expect(packageJson).not.toContain("bundled-pkg-firefox");
  expect(runtimePackage).toContain('"--artifacts-dir"');
  expect(runtimePackage).toContain('"--overwrite-dest"');
});
