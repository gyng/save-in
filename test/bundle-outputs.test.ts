import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("cleans bundle output and stages only declared rolldown artifacts", () => {
  const stage = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const cleanup = stage.indexOf("fs.rmSync(bundleDir");
  const bundle = stage.indexOf("execFileSync(");

  expect(cleanup).toBeGreaterThan(-1);
  expect(cleanup).toBeLessThan(bundle);
  expect(stage).toContain("const bundleFiles = [");
  expect(stage).toContain("for (const f of bundleFiles)");
  expect(stage).toContain("const runtimeAssetDirectories = [");
  expect(stage).toContain("const runtimeAssetFiles = [");
  expect(stage).toContain("for (const directory of runtimeAssetDirectories)");
  expect(stage).toContain("for (const file of runtimeAssetFiles)");
});

test("writes bundle targets sequentially so shared output cleanup cannot race", () => {
  const bundle = readFileSync(resolve("scripts/bundle.js"), "utf8");
  expect(bundle).toContain("for (const config of configs)");
  expect(bundle).toContain("await build(config)");
  expect(bundle).not.toContain("build(configs)");
});

test("ships a self-verifying Mozilla source attachment", () => {
  const sourceBuild = readFileSync(resolve("scripts/build-source-package.js"), "utf8");
  const ci = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");

  for (const required of [
    '"assets"',
    '"assets/README.md"',
    '"assets/icons/notification-info.svg"',
    '"docs/ARCH-CYCLES.md"',
    '"docs/STORE-SUBMISSION.md"',
    '"docs/TS-MIGRATION.md"',
    '"e2e"',
    '"CHANGELOG.md"',
    '"tsconfig.chrome.json"',
    '"tsconfig.dev-tools.json"',
    '"tsconfig.e2e.json"',
    '"tsconfig.worker.json"',
    '"tsconfig.tools.json"',
    '"tsconfig.test.json"',
    '"!.gitignore"',
    '"!.oxlintrc.json"',
    '"!.oxfmtrc.json"',
    '"!.github/**/*"',
    "verifyArchive",
    "canonicalizeZip",
  ]) {
    expect(sourceBuild).toContain(required);
  }
  expect(sourceBuild).not.toMatch(/^\s+"docs",$/m);
  for (const excludedPrefix of [
    '"docs/archive/"',
    '"docs/store-assets/"',
    '"docs/store-screenshots/"',
  ]) {
    expect(sourceBuild).toContain(excludedPrefix);
  }
  expect(ci).toContain("npm run build:source");
});

test("creates stable archives without generated checkout metadata", () => {
  const runtimeBuild = readFileSync(resolve("scripts/build-bundled.js"), "utf8");
  const runtimePackage = readFileSync(resolve("scripts/package-runtime.js"), "utf8");
  const sourceBuild = readFileSync(resolve("scripts/build-source-package.js"), "utf8");
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

  expect(runtimeBuild).toContain("assertPackageVersion(root)");
  expect(runtimePackage).toContain("canonicalizeZip");
  expect(runtimePackage).toContain("assertPackageVersion(root)");
  expect(runtimePackage).toContain('"--no-config-discovery"');
  expect(runtimePackage).toContain('"save-in-{version}.zip"');
  expect(sourceBuild).toContain("assertPackageVersion(root)");
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
  const runtimePackage = readFileSync(resolve("scripts/package-runtime.js"), "utf8");

  expect(manifest.incognito).toBe("spanning");
  expect(stage).toContain('service_worker: "background.sw.js"');
  expect(stage).toContain('scripts: ["background.js"]');
  expect(runtimePackage).toContain('"--artifacts-dir"');
  expect(runtimePackage).toContain('"--overwrite-dest"');
});
