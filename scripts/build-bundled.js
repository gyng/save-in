// Stages a store-submission package that loads the rolldown bundles (one
// readable, non-minified file per target) instead of the many source scripts.
// Secondary pages (variablelist/clauselist) keep their few source scripts, so
// the staged tree stays complete. E2E builds use isolated output directories
// so a store/dev build cannot replace the test-control bundle between build
// verification and browser startup.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const writeVersion = require("./write-version");

writeVersion();

const root = path.join(__dirname, "..");
const expectE2EBridge = process.env.SAVE_IN_E2E === "1";
const bundleDir = path.join(root, "dist", expectE2EBridge ? "bundled-e2e" : "bundled");
const out = path.join(root, "dist", expectE2EBridge ? "bundled-pkg-e2e" : "bundled-pkg");

// 1. Build the bundles without going through a platform shell.
execFileSync(
  process.execPath,
  [path.join(root, "node_modules", "rolldown", "bin", "cli.mjs"), "-c", "rolldown.config.mjs"],
  { cwd: root, stdio: "inherit" },
);

// The store bundle must never expose the privileged browser-test command API.
// Conversely, fail e2e staging early if its bridge was accidentally omitted.
for (const filename of ["background.js", "background.sw.js"]) {
  const bundle = fs.readFileSync(path.join(bundleDir, filename), "utf8");
  if (bundle.includes("__SAVE_IN_E2E__") !== expectE2EBridge) {
    throw new Error(`Unexpected e2e bridge surface in ${filename}`);
  }
}
const contentBundle = fs.readFileSync(path.join(bundleDir, "content.js"), "utf8");
const contentShadowMode = contentBundle.match(/attachShadow\(\{\s*mode:\s*"(open|closed)"/)?.[1];
const expectedContentShadowMode = expectE2EBridge ? "open" : "closed";
if (
  contentShadowMode !== expectedContentShadowMode ||
  contentBundle.includes("SAVE_IN_CONTENT_E2E")
) {
  throw new Error("Unexpected content panel shadow mode");
}

// 2. Stage runtime assets. Original TypeScript belongs in the separate AMO
// source attachment, not in the executable store package.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "src"), path.join(out, "src"), {
  recursive: true,
  filter: (source) => path.extname(source) !== ".ts",
});
["icons", "_locales"].forEach((dir) => {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
});
fs.copyFileSync(path.join(root, "LICENSE"), path.join(out, "LICENSE"));
fs.copyFileSync(path.join(root, "PRIVACY.md"), path.join(out, "PRIVACY.md"));

// 3. Drop the bundles at the package root
for (const f of fs.readdirSync(bundleDir)) {
  // Older builds emitted this standalone file. Reference pages now own their
  // copy behavior, so never let a stale local bundle leak into a store ZIP.
  if (f === "clicktocopy.js" || f === "clicktocopy.js.map") continue;
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
// Secondary help pages share the searchable/copyable reference controller.
rewriteHtml("src/options/variablelist.html", "../../reference-page.js");
rewriteHtml("src/options/clauselist.html", "../../reference-page.js");

process.stdout.write(`Staged bundled package in ${out}\n`);
