// Stamps src/options/version.json with the current commit and date, shown
// in the options page top bar next to the runtime manifest version. The
// file is gitignored (build metadata, not source); the options page
// degrades to just the version when it is missing.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * @param {{
 *   existing?: { commit?: string, date?: string },
 *   sourceCommit?: string,
 *   sourceDate?: string,
 *   gitCommit?: string,
 *   today: string,
 * }} input
 */
const resolveVersionMetadata = ({ existing = {}, sourceCommit, sourceDate, gitCommit, today }) => {
  const currentCommit = sourceCommit || gitCommit;
  return {
    commit: currentCommit || existing.commit || "unknown",
    // A source attachment has no Git checkout, so retain its release stamp.
    // Builds from a current checkout should report when that checkout was built.
    date: sourceDate || (currentCommit ? today : existing.date || today),
  };
};

const writeVersion = () => {
  const root = path.join(__dirname, "..");
  const outputPath = path.join(root, "src", "options", "version.json");
  /** @type {{ commit?: string, date?: string }} */
  let existing = {};
  if (fs.existsSync(outputPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    } catch (e) {
      // Replace malformed generated metadata below.
    }
  }

  let gitCommit;
  if (!process.env.SOURCE_COMMIT) {
    try {
      gitCommit = execFileSync(
        "git",
        ["-c", `safe.directory=${root.replace(/\\/g, "/")}`, "rev-parse", "--short", "HEAD"],
        { cwd: root, stdio: ["ignore", "pipe", "ignore"] },
      )
        .toString()
        .trim();
    } catch (e) {
      // A source attachment has no .git directory; preserve its release stamp.
    }
  }
  const { commit, date } = resolveVersionMetadata({
    existing,
    sourceCommit: process.env.SOURCE_COMMIT,
    sourceDate: process.env.SOURCE_DATE,
    gitCommit,
    today: new Date().toISOString().slice(0, 10),
  });
  const output = `${JSON.stringify({ commit, date })}\n`;
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
    fs.writeFileSync(outputPath, output);
  }
  return { commit, date };
};

if (require.main === module) {
  const { commit, date } = writeVersion();
  console.log(`write-version: ${commit} ${date}`);
}

module.exports = Object.assign(writeVersion, { resolveVersionMetadata });
