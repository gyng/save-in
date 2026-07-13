const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const acquireDirectoryLock = (
  lockDir,
  { timeoutMs = 120_000, pollMs = 100, pid = process.pid } = {},
) => {
  const token = `${pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid, token }));
      return { lockDir, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
        if (!processIsAlive(owner.pid)) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (ownerError) {
        // A competing process may still be writing its owner file. If it died
        // between mkdir and write, reclaim the ownerless directory promptly.
        try {
          if (Date.now() - fs.statSync(lockDir).mtimeMs > 2_000) {
            fs.rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
      }
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for E2E staging lock: ${lockDir}`);
      sleepSync(pollMs);
    }
  }
};

const releaseDirectoryLock = ({ lockDir, token }) => {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    if (owner.token !== token)
      throw new Error(`Refusing to release an E2E lock owned by another process: ${lockDir}`);
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};

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
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runPath = path.join(artifacts, entry.name);
    const mtime = fs.statSync(runPath).mtimeMs;
    const marker = path.join(runPath, ".active");
    if (fs.existsSync(marker)) {
      const pid = Number(fs.readFileSync(marker, "utf8"));
      if (Number.isInteger(pid) && processIsAlive(pid)) continue;
      fs.rmSync(marker, { force: true });
    }
    runs.push({ path: runPath, mtime });
  }
  const sortedRuns = runs.toSorted((a, b) => b.mtime - a.mtime);
  for (const oldRun of sortedRuns.slice(keep)) {
    fs.rmSync(oldRun.path, { recursive: true, force: true });
  }
};

const pruneRunDirectories = (runRoot) => {
  if (!fs.existsSync(runRoot)) return;
  for (const entry of fs.readdirSync(runRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pid = Number(entry.name);
    if (!Number.isInteger(pid) || !processIsAlive(pid)) {
      fs.rmSync(path.join(runRoot, entry.name), { recursive: true, force: true });
    }
  }
};

module.exports = {
  acquireDirectoryLock,
  pruneArtifactRuns,
  pruneRunDirectories,
  releaseDirectoryLock,
  removeOwnedProfiles,
  removeWithRetries,
};
