// @ts-check

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
/** @type {string[]} */
const violations = [];

/** @param {string} name */
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
/** @param {string} name */
const readJson = (name) => JSON.parse(read(name).replace(/^\s*\/\/.*$/gm, ""));
/** @param {boolean} condition @param {string} message */
const check = (condition, message) => {
  if (!condition) violations.push(message);
};
/** @param {string} name @param {string} required */
const contains = (name, required) =>
  check(read(name).includes(required), `${name}: missing ${JSON.stringify(required)}`);
/** @param {string} name @param {string} forbidden */
const excludes = (name, forbidden) =>
  check(
    !read(name).includes(forbidden),
    `${name}: contains forbidden ${JSON.stringify(forbidden)}`,
  );

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
check(manifest.version === packageJson.version, "manifest.json and package.json versions differ");
check(manifest.minimum_chrome_version === "123", "manifest minimum Chrome version must be 123");
check(manifest.incognito === "spanning", "manifest incognito mode must remain spanning");
check(
  !(manifest.permissions || []).includes("cookies") &&
    !(manifest.optional_permissions || []).includes("cookies"),
  "manifest must not request cookie access",
);
check(
  (manifest.permissions || []).includes("declarativeNetRequestWithHostAccess"),
  "manifest must request scoped request-header access for the Referer feature",
);
check(
  JSON.stringify(manifest.commands?.["toggle-source-panel"]?.suggested_key) ===
    JSON.stringify({ default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" }),
  "Page Sources must keep its cross-platform default shortcut",
);
check(
  JSON.stringify(manifest.background) ===
    JSON.stringify({ scripts: ["background.js"], service_worker: "background.sw.js" }),
  "manifest background templates must target both bundled entry files",
);
check(
  JSON.stringify(manifest.content_scripts?.[0]?.js) === JSON.stringify(["content.js"]),
  "manifest content script template must target content.js",
);

const optionsHtml = read("src/options/options.html");
check(
  (optionsHtml.match(/<script[^>]+src=/g) || []).length === 1 &&
    optionsHtml.includes('src="../../options.js"'),
  "options HTML must load only the generated options bundle",
);

const typecheck = packageJson.scripts?.typecheck || "";
for (const config of [
  "tsconfig.browser.json",
  "tsconfig.chrome.json",
  "tsconfig.worker.json",
  "tsconfig.tools.json",
  "tsconfig.dev-tools.json",
  "tsconfig.e2e.json",
  "tsconfig.test.json",
]) {
  check(typecheck.includes(config), `package.json: typecheck must include ${config}`);
}

const baseOptions = readJson("tsconfig.json").compilerOptions || {};
for (const [name, expected] of Object.entries({
  strict: true,
  skipLibCheck: false,
  forceConsistentCasingInFileNames: true,
  noFallthroughCasesInSwitch: true,
  noImplicitReturns: true,
})) {
  check(
    baseOptions[name] === expected,
    `tsconfig.json: compilerOptions.${name} must be ${expected}`,
  );
}
check(!("allowJs" in baseOptions), "tsconfig.json: allowJs belongs only in tooling/test configs");
const browserOptions = readJson("tsconfig.browser.json").compilerOptions || {};
check(browserOptions.exactOptionalPropertyTypes === true, "browser config needs exact optionals");
check(browserOptions.noUncheckedIndexedAccess === true, "browser config needs checked indexing");
const worker = readJson("tsconfig.worker.json");
check(
  JSON.stringify(worker.compilerOptions?.lib) === JSON.stringify(["es2023", "webworker"]),
  "worker config must remain DOM-free",
);
check(
  worker.include?.includes("src/entries/background.ts"),
  "worker config must check background entry",
);
check(
  readJson("tsconfig.browser.json").exclude?.includes("types/host-chrome.d.ts"),
  "Firefox host check must exclude Chrome declarations",
);
check(
  readJson("tsconfig.chrome.json").exclude?.includes("types/host-firefox.d.ts"),
  "Chrome host check must exclude Firefox declarations",
);

const tools = readJson("tsconfig.tools.json");
check(
  tools.compilerOptions?.allowJs === true &&
    tools.compilerOptions?.checkJs === true &&
    tools.compilerOptions?.noEmit === true &&
    tools.compilerOptions?.strict === true,
  "tooling config must strictly check JavaScript without emitting",
);
check(
  tools.include?.includes("scripts/**/*.js"),
  "tooling config must check every repository script",
);
for (const script of fs.globSync("scripts/**/*.js", { cwd: root })) {
  check(read(script).startsWith("// @ts-check"), `${script}: missing // @ts-check`);
}
check(
  readJson("tsconfig.dev-tools.json").extends === "./tsconfig.tools.json" &&
    readJson("tsconfig.e2e.json").extends === "./tsconfig.tools.json",
  "dev and E2E tooling configs must extend the strict tooling config",
);
check(
  readJson("tsconfig.test.json").include?.includes("test/**/*.ts"),
  "test config must include the complete TypeScript suite",
);

for (const name of ["e2e:chrome", "e2e:firefox"]) {
  const command = packageJson.scripts?.[name] || "";
  check(command.includes("HEADLESS=1"), `package.json: ${name} must be headless by default`);
  check(
    command.includes("EXT_DIR=dist/bundled-pkg-e2e"),
    `package.json: ${name} must use the isolated E2E package`,
  );
}
check(
  packageJson.scripts?.["e2e:headed"]?.includes("HEADED=1"),
  "package.json: headed E2E must opt in explicitly",
);

contains("scripts/build-bundled.js", "assertPackageVersion(root)");
contains("scripts/build-bundled.js", 'expectE2EControl ? "bundled-pkg-e2e" : "bundled-pkg"');
contains("scripts/build-bundled.js", "parseBuildMode(process.argv.slice(2))");
const runtimeBuild = read("scripts/build-bundled.js");
const cleanupIndex = runtimeBuild.indexOf("fs.rmSync(bundleDir");
const bundleIndex = runtimeBuild.indexOf("execFileSync(");
check(
  cleanupIndex >= 0 && bundleIndex >= 0 && cleanupIndex < bundleIndex,
  "bundle output must be cleaned before bundling",
);
for (const contract of [
  "const bundleFiles = [",
  "for (const f of bundleFiles)",
  "const runtimeAssetDirectories = [",
  "const runtimeAssetFiles = [",
  "for (const directory of runtimeAssetDirectories)",
  "for (const file of runtimeAssetFiles)",
]) {
  check(runtimeBuild.includes(contract), `runtime staging is missing ${contract}`);
}
const bundleScript = read("scripts/bundle.js");
check(
  bundleScript.includes("for (const config of configs)") &&
    bundleScript.includes("await build(config)") &&
    !bundleScript.includes("build(configs)"),
  "bundle targets must be written sequentially",
);
contains("scripts/package-runtime.js", "canonicalizeZip");
contains("scripts/package-runtime.js", "assertPackageVersion(root)");
contains("scripts/package-runtime.js", '"--no-config-discovery"');
contains("scripts/package-runtime.js", '"save-in-{version}.zip"');
contains("scripts/build-source-package.js", "assertPackageVersion(root)");
contains("scripts/build-source-package.js", "verifyArchive");
contains("scripts/build-source-package.js", "canonicalizeZip");
contains("rolldown.config.mjs", 'process.env.SAVE_IN_BUILD_MODE === "e2e"');
excludes("rolldown.config.mjs", "SAVE_IN_E2E");
check(
  packageJson.scripts?.["build:bundled"]?.includes("scripts/package-runtime.js"),
  "package.json: bundled build must create the runtime archive",
);

const sourceBuild = read("scripts/build-source-package.js");
for (const required of [
  '"assets/README.md"',
  '"assets/icons/notification-info.svg"',
  '"e2e"',
  '"CHANGELOG.md"',
  '"tsconfig.worker.json"',
  '"tsconfig.tools.json"',
  '"tsconfig.dev-tools.json"',
  '"tsconfig.e2e.json"',
  '"tsconfig.test.json"',
  '"vitest.fuzz.config.mjs"',
  '"!.gitignore"',
  '"!.oxlintrc.json"',
  '"!.oxfmtrc.json"',
  '"!.github/**/*"',
]) {
  check(sourceBuild.includes(required), `source attachment is missing policy entry ${required}`);
}
check(!/^\s+"docs",$/m.test(sourceBuild), "source attachment must not include all documentation");
for (const excluded of ['"docs/"']) {
  check(sourceBuild.includes(excluded), `source attachment must exclude ${excluded}`);
}
contains(".github/workflows/ci.yml", "npm run build:source");

const docs = `${read("README.md")}\n${read("docs/INTEGRATIONS.md")}`;
for (const fact of [
  "Chrome 123+",
  "Firefox",
  "downloads.download({ headers })",
  "declarativeNetRequest",
  "{72d92df5-2aa0-4b06-b807-aa21767545cd}",
  "jpblofcpgfjikaapfedldfeilmpgkedf",
  "platform-specific",
]) {
  check(docs.includes(fact), `documentation is missing release fact ${JSON.stringify(fact)}`);
}
check(
  /temporary,\s+exact declarativeNetRequest rule/i.test(docs),
  "documentation must describe the scoped cross-browser Referer path",
);

const stageRoot = path.join(root, "dist", "bundled-pkg");
for (const name of [
  "manifest.json",
  "background.js",
  "background.sw.js",
  "content.js",
  "options.js",
  "offscreen.js",
  "src/options/options.html",
]) {
  check(fs.existsSync(path.join(stageRoot, name)), `staged package is missing ${name}`);
}
const firefoxBackground = fs.existsSync(path.join(stageRoot, "background.js"))
  ? fs.readFileSync(path.join(stageRoot, "background.js"), "utf8")
  : "";
check(
  !/^(?:const|let|class|function) location\b/m.test(firefoxBackground),
  "Firefox background bundle must not redeclare the non-configurable window.location global",
);

const finish = async () => {
  const configUrl = pathToFileURL(path.join(root, "vitest.config.mjs")).href;
  const { default: vitestConfig, resolveMaxWorkers } = await import(configUrl);
  check(resolveMaxWorkers({ cores: 32 }) === 28, "Vitest must reserve four local CPUs");
  check(resolveMaxWorkers({ cores: 2 }) === 1, "local Vitest workers need a floor");
  check(resolveMaxWorkers({ ci: "true", cores: 8 }) === 8, "CI must use available CPUs");
  check(
    resolveMaxWorkers({ requested: "5", ci: "true", cores: 8 }) === 5 &&
      resolveMaxWorkers({ requested: "0", cores: 8 }) === 1,
    "explicit Vitest worker limits must override defaults with a floor",
  );
  const coverageExclude = vitestConfig.test?.coverage?.exclude || [];
  for (const excluded of ["src/entries/**", "src/options/options.ts"]) {
    check(coverageExclude.includes(excluded), `Vitest coverage must exclude ${excluded}`);
  }
  check(
    !coverageExclude.includes("src/options/**"),
    "pure options modules must remain in coverage",
  );
  check(!coverageExclude.includes("src/entry.*.ts"), "Vitest coverage uses a retired entry glob");

  if (violations.length) {
    for (const violation of violations.toSorted()) {
      process.stderr.write(`Release package violation: ${violation}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write("Release package policy and staged bundle checks passed.\n");
  }
};

finish().catch((error) => {
  process.stderr.write(`Release package check failed: ${String(error)}\n`);
  process.exitCode = 1;
});
