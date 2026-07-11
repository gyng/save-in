// Stages a store-submission package that loads the rolldown bundles (one
// readable, non-minified file per target) instead of the many source scripts.
// Secondary pages (variablelist/clauselist) keep their few source scripts, so
// the staged tree stays complete. Output: dist/bundled-pkg.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const writeVersion = require("./write-version");

writeVersion();

const root = path.join(__dirname, "..");
const out = path.join(root, "dist", "bundled-pkg");

// 1. Build the bundles without going through a platform shell.
execFileSync(
  process.execPath,
  [path.join(root, "node_modules", "rolldown", "bin", "cli.mjs"), "-c", "rolldown.config.mjs"],
  { cwd: root, stdio: "inherit" },
);

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

// 3. Drop the bundles at the package root
for (const f of fs.readdirSync(path.join(root, "dist", "bundled"))) {
  fs.copyFileSync(path.join(root, "dist", "bundled", f), path.join(out, f));
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
// Secondary help pages load only clicktocopy (now a bundled .ts module)
rewriteHtml("src/options/variablelist.html", "../../clicktocopy.js");
rewriteHtml("src/options/clauselist.html", "../../clicktocopy.js");

process.stdout.write(`Staged bundled package in ${out}\n`);
