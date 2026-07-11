// Creates the separate source attachment Mozilla requires for transpiled code.
// The attachment is not an installable extension; reviewers run npm ci and
// npm run build inside it to reproduce the executable store package.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { resolveLocalBin } = require("./with-env");
const writeVersion = require("./write-version");

const root = path.join(__dirname, "..");
const stage = path.join(root, "dist", "source-pkg");
const artifacts = path.join(root, "web-ext-artifacts", "source");

writeVersion();
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(artifacts, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.mkdirSync(artifacts, { recursive: true });

for (const dir of ["src", "scripts", "test", "types", "icons", "_locales", "docs"]) {
  fs.cpSync(path.join(root, dir), path.join(stage, dir), { recursive: true });
}

const files = [
  ".oxlintrc.json",
  "AGENTS.md",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "rolldown.config.mjs",
  "tsconfig.browser.json",
  "tsconfig.json",
  "vitest.config.mjs",
  "vitest.e2e.config.mjs",
];
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}

const webExt = resolveLocalBin("web-ext", root);
if (!webExt) throw new Error("web-ext is not installed; run npm install");
execFileSync(
  process.execPath,
  [webExt, "build", "--source-dir", stage, "--artifacts-dir", artifacts, "--overwrite-dest"],
  { cwd: root, stdio: "inherit" },
);

const built = fs.readdirSync(artifacts).find((file) => file.endsWith(".zip"));
if (!built) throw new Error("web-ext did not create a source archive");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const destination = path.join(artifacts, `save-in-${version}-source.zip`);
fs.renameSync(path.join(artifacts, built), destination);
process.stdout.write(`Mozilla source attachment ready: ${destination}\n`);
