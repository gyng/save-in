const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const removeWithRetries = async (target, { attempts = 6, delayMs = 500 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target)) return;
    } catch (error) {
      // Browser children can release profile files after their suite exits.
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs);
  }
  throw new Error(`Unable to remove interrupted E2E profile: ${target}`);
};

const removeOwnedProfiles = async (childPids, { chromeRoot, firefoxRoot, attempts, delayMs }) => {
  const roots = [
    { dir: chromeRoot, prefix: "e2e-profile-" },
    { dir: firefoxRoot, prefix: "save-in-ff-e2e-" },
  ];
  const failures = [];
  for (const { dir, prefix } of roots) {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (
        entry.isDirectory() &&
        childPids.some((pid) => entry.name.startsWith(`${prefix}${pid}-`))
      ) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await removeWithRetries(path.join(dir, entry.name), { attempts, delayMs });
        } catch (error) {
          failures.push(error);
        }
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "E2E profile cleanup failed");
};

const pruneArtifactRuns = (artifacts, keep = 3) => {
  fs.mkdirSync(artifacts, { recursive: true });
  const entries = fs.readdirSync(artifacts, { withFileTypes: true });
  for (const legacy of entries) {
    if (legacy.isFile()) fs.rmSync(path.join(artifacts, legacy.name), { force: true });
  }
  const runs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
    .map((entry) => ({
      path: path.join(artifacts, entry.name),
      mtime: fs.statSync(path.join(artifacts, entry.name)).mtimeMs,
    }))
    .toSorted((a, b) => b.mtime - a.mtime);
  for (const oldRun of runs.slice(keep)) {
    fs.rmSync(oldRun.path, { recursive: true, force: true });
  }
};

module.exports = { pruneArtifactRuns, removeOwnedProfiles, removeWithRetries };
