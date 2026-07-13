const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { canonicalizeZip } = require("./lib/canonicalize-zip");
const { assertPackageVersion } = require("./lib/package-metadata");
const { resolveLocalBin } = require("./with-env");

async function main() {
  const root = path.join(__dirname, "..");
  const version = assertPackageVersion(root);
  const artifacts = path.join(root, "web-ext-artifacts");
  const destination = path.join(artifacts, `save-in-${version}.zip`);
  const webExt = resolveLocalBin("web-ext", root);
  if (!webExt) throw new Error("web-ext is not installed; run npm install");
  fs.mkdirSync(artifacts, { recursive: true });
  const env = { ...process.env };
  delete env.WEB_EXT_API_KEY;
  delete env.WEB_EXT_API_SECRET;
  execFileSync(
    process.execPath,
    [
      webExt,
      "build",
      "--source-dir",
      path.join(root, "dist", "bundled-pkg"),
      "--artifacts-dir",
      artifacts,
      "--filename",
      "save-in-{version}.zip",
      "--no-config-discovery",
      "--overwrite-dest",
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
    },
  );
  await canonicalizeZip(destination);
  process.stdout.write(`Deterministic runtime package ready: ${destination}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
