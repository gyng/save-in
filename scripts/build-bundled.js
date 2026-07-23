// @ts-check

// Stages a store-submission package that loads the rolldown bundles (one
// readable, non-minified file per target) instead of the many source scripts.
// Reference pages share their own bundle. E2E builds use isolated output
// directories so a store/dev build cannot replace the test-control bundle
// between build verification and browser startup.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { assertPackageVersion } = require("./lib/package-metadata");
const { assertBackgroundControlSurface } = require("./lib/bundle-control-surface");
const { parseBuildMode } = require("./lib/build-mode");
const { acquireDirectoryLock, releaseDirectoryLock } = require("./lib/e2e-cleanup");

const root = path.join(__dirname, "..");
assertPackageVersion(root);
const buildMode = parseBuildMode(process.argv.slice(2));
const expectE2EControl = buildMode === "e2e";
const bundleDir = path.join(root, "dist", expectE2EControl ? "bundled-e2e" : "bundled");
const out = path.join(root, "dist", expectE2EControl ? "bundled-pkg-e2e" : "bundled-pkg");
const bundleFiles = [
  "background.js",
  "background.js.map",
  "background.sw.js",
  "background.sw.js.map",
  "content.js",
  "content.js.map",
  "offscreen.js",
  "offscreen.js.map",
  "options.js",
  "options.js.map",
  "reference-page.js",
  "reference-page.js.map",
  ...(expectE2EControl ? ["e2e-control.js", "e2e-control.js.map"] : []),
];
const optionStyleFiles = [
  "reference/reference.css",
  "style.css",
  "skins/skin-webring.css",
  "skins/skin-phosphor.css",
  "styles/style-accessibility.css",
  "dialogs/style-about.css",
  "core/style-advanced.css",
  "integrations/style-webhook.css",
  "integrations/style-advanced-integrations.css",
  "integrations/style-prompt-assistant.css",
  "core/style-advanced-responsive.css",
  "core/style-automation.css",
  "styles/style-base.css",
  "styles/style-components.css",
  "styles/style-feedback.css",
  "styles/style-option-rows.css",
  "core/style-workflows.css",
  "styles/style-status.css",
  "syntax-editor/style-syntax-editor.css",
  "syntax-editor/style-syntax-popovers.css",
  "ui/style-typeahead.css",
  "history/style-history.css",
  "history/style-history-metadata.css",
  "history/style-history-responsive.css",
  "styles/style-layout.css",
  "reference/style-variables-preview.css",
  "styles/style-layout-responsive.css",
  "rule-editor/style-template-library.css",
  "core/style-option-tools.css",
  "core/style-visual-editor-controls.css",
  "path-editor/style-editor-actions.css",
  "path-editor/style-path-editor.css",
  "path-editor/style-menu-preview.css",
  "styles/style-shell-responsive.css",
  "core/style-source-settings.css",
  "dialogs/style-dialogs.css",
  "reference/style-editor-reference.css",
  "path-editor/style-editor-responsive.css",
  "reference/style-reference.css",
  "route-debugger/style-route-debugger.css",
  "route-debugger/style-route-debugger-trace.css",
  "route-debugger/style-route-debugger-tools.css",
  "route-debugger/style-route-debugger-responsive.css",
  "rule-editor/style-rule-editor.css",
  "rule-editor/style-rule-editor-clauses.css",
  "rule-editor/style-rule-editor-create.css",
  "styles/style-shell.css",
  "styles/style-theme-palettes.css",
  "styles/style-themes.css",
  "styles/style-tokens.css",
  "styles/style-utilities.css",
  "dialogs/style-welcome.css",
  "dialogs/welcome-dialog.css",
];
const runtimeAssetDirectories = ["src/i18n/generated", "src/options/assets", "src/options/i"];
const runtimeAssetFiles = [
  "src/offscreen.html",
  "src/options/clauselist.html",
  "src/options/favicon.png",
  "src/options/options.html",
  ...optionStyleFiles.map((file) => `src/options/${file}`),
  ...(expectE2EControl ? ["test/e2e/control.html"] : []),
];

const stageBundledPackage = () => {
  // 1. Build the bundles without going through a platform shell. Rolldown does
  // not remove outputs for entries deleted from its config, so start clean to
  // keep local/manual release artifacts as reproducible as clean CI builds.
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  execFileSync(process.execPath, [path.join(root, "scripts", "bundle.js"), `--mode=${buildMode}`], {
    cwd: root,
    stdio: "inherit",
  });
  const actualBundleFiles = fs.readdirSync(bundleDir).toSorted();
  if (JSON.stringify(actualBundleFiles) !== JSON.stringify(bundleFiles.toSorted())) {
    throw new Error(`Unexpected rolldown outputs: ${actualBundleFiles.join(", ")}`);
  }

  // The store bundle must never expose the browser-test command. Conversely,
  // fail e2e staging early if its command was accidentally omitted.
  assertBackgroundControlSurface(bundleDir, expectE2EControl);
  const contentBundle = fs.readFileSync(path.join(bundleDir, "content.js"), "utf8");
  const contentShadowMode = contentBundle.match(/attachShadow\(\{\s*mode:\s*"(open|closed)"/)?.[1];
  const expectedContentShadowMode = expectE2EControl ? "open" : "closed";
  if (
    contentShadowMode !== expectedContentShadowMode ||
    contentBundle.includes("SAVE_IN_CONTENT_E2E")
  ) {
    throw new Error("Unexpected content panel shadow mode");
  }

  // 2. Stage only declared runtime assets. Original TypeScript and editable
  // design sources belong in the separate AMO source attachment, not in the
  // executable store package.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const directory of runtimeAssetDirectories) {
    fs.cpSync(path.join(root, directory), path.join(out, directory), { recursive: true });
  }
  for (const file of runtimeAssetFiles) {
    const destination = path.join(out, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  ["icons", "_locales"].forEach((dir) => {
    fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
  });
  fs.copyFileSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
  fs.copyFileSync(path.join(root, "PRIVACY.md"), path.join(out, "PRIVACY.md"));

  // 3. Drop only the declared bundles at the package root.
  for (const f of bundleFiles) {
    fs.copyFileSync(path.join(bundleDir, f), path.join(out, f));
  }

  // 4. Point the manifest at the bundles
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  manifest.background = {
    scripts: ["background.js"],
    service_worker: "background.sw.js",
  };
  manifest.content_scripts[0].js = ["content.js"];
  fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // 5. Rewrite the entry pages to load their single bundle instead of the many
  //    source scripts. `bundleHref` is relative to the page's own location.
  /** @param {string} htmlRel @param {string} bundleHref */
  const rewriteHtml = (htmlRel, bundleHref) => {
    const p = path.join(out, htmlRel);
    let html = fs.readFileSync(p, "utf8");
    // Drop every local <script src="…"> (keep remote ones, though there are none)
    html = html.replace(/[ \t]*<script[^>]*\ssrc="(?!https?:)[^"]+"[^>]*><\/script>\n?/g, "");
    const tag = `<script src="${bundleHref}"></script>`;
    html = html.includes("</body>")
      ? html.replace("</body>", `    ${tag}\n  </body>`)
      : `${html.trimEnd()}\n${tag}\n`;
    fs.writeFileSync(p, html);
  };

  rewriteHtml("src/options/options.html", "../../options.js");
  rewriteHtml("src/offscreen.html", "../offscreen.js");
  // The secondary clause help page uses the searchable/copyable reference controller.
  rewriteHtml("src/options/clauselist.html", "../../reference-page.js");
  if (expectE2EControl) rewriteHtml("test/e2e/control.html", "../../e2e-control.js");

  process.stdout.write(`Staged bundled package in ${out}\n`);
};

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const buildLock = acquireDirectoryLock(path.join(root, "dist", `.build-bundled-${buildMode}.lock`));
try {
  stageBundledPackage();
} finally {
  releaseDirectoryLock(buildLock);
}
