// Validates the release tag, gives build artifacts stable public names, and
// writes checksums for GitHub Release upload and provenance attestation.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * @param {string} tag
 * @param {string} packageVersion
 * @param {string} manifestVersion
 */
function releaseVersion(tag, packageVersion, manifestVersion) {
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Release tag must be v-prefixed semver, received: ${tag}`);
  }
  if (packageVersion !== manifestVersion) {
    throw new Error(
      `package.json and manifest.json versions do not match: ${packageVersion} != ${manifestVersion}`,
    );
  }
  const version = tag.slice(1);
  if (version !== packageVersion) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}`);
  }
  return version;
}

/** @param {string} root @param {string} tag */
function readVersion(root, tag) {
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const manifestVersion = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  ).version;
  return releaseVersion(tag, packageVersion, manifestVersion);
}

/** @param {string} root @param {string} tag */
function prepare(root, tag) {
  const version = readVersion(root, tag);
  const artifacts = path.join(root, "web-ext-artifacts");
  const output = path.join(artifacts, "release");
  const files = [
    {
      source: path.join(artifacts, `save-in-${version}.zip`),
      name: `save-in-${version}.zip`,
    },
    {
      source: path.join(artifacts, "source", `save-in-${version}-source.zip`),
      name: `save-in-${version}-source.zip`,
    },
  ];

  for (const file of files) {
    if (!fs.existsSync(file.source)) {
      throw new Error(`Missing release artifact: ${file.source}`);
    }
  }

  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(file.source, path.join(output, file.name));
  }

  const checksums = files
    .map(({ name }) => {
      const contents = fs.readFileSync(path.join(output, name));
      return `${crypto.createHash("sha256").update(contents).digest("hex")}  ${name}`;
    })
    .join("\n");
  fs.writeFileSync(path.join(output, "SHA256SUMS"), `${checksums}\n`);
  return { version, output };
}

function main() {
  const root = path.join(__dirname, "..");
  const args = process.argv.slice(2);
  const checkOnly = args[0] === "--check";
  const tag = args[checkOnly ? 1 : 0];
  if (!tag) throw new Error("Missing release tag");

  if (checkOnly) {
    const version = readVersion(root, tag);
    process.stdout.write(`Release tag and manifests agree on ${version}\n`);
    return;
  }

  const { output } = prepare(root, tag);
  process.stdout.write(`Release artifacts ready: ${output}\n`);
}

if (require.main === module) main();

module.exports = { prepare, releaseVersion };
