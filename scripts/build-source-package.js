// Creates the separate source attachment Mozilla requires for transpiled code.
// The attachment is not an installable extension; reviewers run npm ci and
// npm run build inside it to reproduce the executable store package.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { canonicalizeZip } = require("./lib/canonicalize-zip");
const { assertPackageVersion } = require("./lib/package-metadata");
const { resolveLocalBin } = require("./with-env");

const root = path.join(__dirname, "..");
const stage = path.join(root, "dist", "source-pkg");
const artifacts = path.join(root, "web-ext-artifacts", "source");
const excludedSourceFiles = new Set(["src/options/version.json"]);

/** @param {Buffer} contents */
function zipEntries(contents) {
  const minimumEocdSize = 22;
  const maximumCommentSize = 65_535;
  let eocd = -1;
  for (
    let offset = contents.length - minimumEocdSize;
    offset >= Math.max(0, contents.length - minimumEocdSize - maximumCommentSize);
    offset -= 1
  ) {
    if (contents.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Source archive has no ZIP central directory");

  const entryCount = contents.readUInt16LE(eocd + 10);
  let offset = contents.readUInt32LE(eocd + 16);
  const entries = new Set();
  for (let index = 0; index < entryCount; index += 1) {
    if (contents.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Source archive has a malformed ZIP central directory");
    }
    const nameLength = contents.readUInt16LE(offset + 28);
    const extraLength = contents.readUInt16LE(offset + 30);
    const commentLength = contents.readUInt16LE(offset + 32);
    entries.add(contents.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** @param {string} archive @param {string[]} required */
function verifyArchive(archive, required) {
  const entries = zipEntries(fs.readFileSync(archive));
  const missing = required.filter((file) => !entries.has(file));
  if (missing.length) throw new Error(`Source archive is missing: ${missing.join(", ")}`);
}

async function main() {
  const version = assertPackageVersion(root);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.rmSync(artifacts, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.mkdirSync(artifacts, { recursive: true });

  for (const dir of [
    ".github",
    "src",
    "scripts",
    "test",
    "e2e",
    "types",
    "icons",
    "_locales",
    "docs",
  ]) {
    fs.cpSync(path.join(root, dir), path.join(stage, dir), {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(root, source).replaceAll(path.sep, "/");
        return !excludedSourceFiles.has(relative);
      },
    });
  }

  const files = [
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    ".oxfmtrc.json",
    ".oxlintrc.json",
    "AGENTS.md",
    "CHANGELOG.md",
    "LICENSE",
    "PRIVACY.md",
    "README.md",
    "manifest.json",
    "package-lock.json",
    "package.json",
    "rolldown.config.mjs",
    "tsconfig.browser.json",
    "tsconfig.chrome.json",
    "tsconfig.json",
    "tsconfig.test.json",
    "tsconfig.tools-legacy.json",
    "tsconfig.tools.json",
    "tsconfig.worker.json",
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
    [
      webExt,
      "build",
      "--source-dir",
      stage,
      "--artifacts-dir",
      artifacts,
      "--filename",
      "save-in-{version}-source.zip",
      "--no-config-discovery",
      "--overwrite-dest",
      "--ignore-files",
      "!.gitattributes",
      "!.gitignore",
      "!.npmrc",
      "!.oxfmtrc.json",
      "!.oxlintrc.json",
      "!.github",
      "!.github/**/*",
    ],
    { cwd: root, stdio: "inherit" },
  );

  const destination = path.join(artifacts, `save-in-${version}-source.zip`);
  await canonicalizeZip(destination);
  verifyArchive(destination, [
    ".gitattributes",
    ".gitignore",
    ".npmrc",
    ".oxfmtrc.json",
    ".oxlintrc.json",
    ".github/workflows/ci.yml",
    "CHANGELOG.md",
    "e2e/chrome.e2e.mjs",
    "e2e/firefox.e2e.mjs",
    "tsconfig.chrome.json",
    "tsconfig.test.json",
    "tsconfig.tools-legacy.json",
    "tsconfig.tools.json",
    "tsconfig.worker.json",
  ]);
  process.stdout.write(`Mozilla source attachment ready: ${destination}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main, verifyArchive, zipEntries };
