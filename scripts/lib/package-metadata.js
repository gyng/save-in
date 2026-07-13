const fs = require("fs");
const path = require("path");

/** @param {string} root */
function assertPackageVersion(root) {
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const manifestVersion = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  ).version;
  if (
    typeof packageVersion !== "string" ||
    !packageVersion ||
    typeof manifestVersion !== "string" ||
    !manifestVersion
  ) {
    throw new Error("package.json and manifest.json must declare a non-empty version");
  }
  if (packageVersion !== manifestVersion) {
    throw new Error(
      `package.json and manifest.json versions do not match: ${packageVersion} != ${manifestVersion}`,
    );
  }
  return packageVersion;
}

module.exports = { assertPackageVersion };
