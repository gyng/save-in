// Stamps src/options/version.json with the current commit and date, shown
// in the options page top bar next to the runtime manifest version. The
// file is gitignored (build metadata, not source); the options page
// degrades to just the version when it is missing.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const writeVersion = () => {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD").toString().trim();
  } catch (e) {
    // not a git checkout (e.g. a source tarball); keep the placeholder
  }
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(__dirname, "..", "src", "options", "version.json"),
    `${JSON.stringify({ commit, date })}\n`,
  );
  return { commit, date };
};

if (require.main === module) {
  const { commit, date } = writeVersion();
  console.log(`write-version: ${commit} ${date}`);
}

module.exports = writeVersion;
