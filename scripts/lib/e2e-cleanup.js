// @ts-check

const fs = require("fs");
const path = require("path");

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @param {number} ms */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {unknown} error @returns {string | undefined} */
const errorCode = (error) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

/** @param {number} pid */
const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
};

/** @param {number} pid @param {number} runStartedAt */
const processOwnsRun = (pid, runStartedAt) => {
  if (!processIsAlive(pid)) return false;
  if (process.platform !== "linux") return true;
  try {
    // PID namespaces can reuse low IDs rapidly. A process created after the
    // timestamp embedded in the profile name cannot own that older profile.
    return fs.statSync(`/proc/${pid}`).mtimeMs <= runStartedAt + 1_000;
  } catch {
    return true;
  }
};

/**
 * Claims stale-lock cleanup with an exclusive marker inside the lock. A
 * contender that does not own the marker must leave the directory untouched.
 *
 * @param {string} lockDir
 * @param {{orphanedAfterMs?: number, pid?: number}} [options]
 */
const tryReclaimDirectoryLock = (lockDir, { orphanedAfterMs = 2_000, pid = process.pid } = {}) => {
  let observedMtime;
  try {
    observedMtime = fs.statSync(lockDir).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }

  const claim = path.join(lockDir, ".reclaim.json");
  let handle;
  let ownsClaim = false;
  try {
    handle = fs.openSync(claim, "wx");
    ownsClaim = true;
    fs.writeFileSync(handle, JSON.stringify({ pid }));
    fs.closeSync(handle);
    handle = undefined;
  } catch (error) {
    if (handle !== undefined) fs.closeSync(handle);
    if (ownsClaim) fs.rmSync(claim, { force: true });
    if (errorCode(error) === "EEXIST") return false;
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }

  let removed = false;
  try {
    let stale = false;
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
      stale = !processIsAlive(owner.pid);
    } catch (error) {
      stale = Date.now() - observedMtime > orphanedAfterMs;
    }
    if (!stale) return false;
    fs.rmSync(lockDir, { recursive: true, force: true });
    removed = true;
    return true;
  } finally {
    if (!removed) fs.rmSync(claim, { force: true });
  }
};

/**
 * @param {string} lockDir
 * @param {{timeoutMs?: number, pollMs?: number, pid?: number}} [options]
 */
const acquireDirectoryLock = (
  lockDir,
  { timeoutMs = 120_000, pollMs = 100, pid = process.pid } = {},
) => {
  const token = `${pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let created = false;
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      created = true;
      fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid, token }));
      return { lockDir, token };
    } catch (error) {
      if (created) fs.rmSync(lockDir, { recursive: true, force: true });
      if (errorCode(error) !== "EEXIST") throw error;
      if (tryReclaimDirectoryLock(lockDir, { pid })) continue;
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for staging lock: ${lockDir}`, { cause: error });
      sleepSync(pollMs);
    }
  }
};

/** @param {{lockDir: string, token: string}} lock */
const releaseDirectoryLock = ({ lockDir, token }) => {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir, "owner.json"), "utf8"));
    if (owner.token !== token)
      throw new Error(`Refusing to release a lock owned by another process: ${lockDir}`);
    fs.rmSync(lockDir, { recursive: true, force: true });
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
};

/** @param {string} target @param {{attempts?: number, delayMs?: number}} [options] */
const removeWithRetries = async (target, { attempts = 6, delayMs = 500 } = {}) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target)) return;
    } catch (error) {
      // Browser children can release profile files after their suite exits.
    }
    await sleep(delayMs);
  }
  throw new Error(`Unable to remove interrupted E2E profile: ${target}`);
};

/**
 * @param {string[]} ownerIds
 * @param {{chromeRoot: string, firefoxRoot: string, attempts?: number, delayMs?: number}} options
 */
const removeOwnedProfiles = async (
  ownerIds,
  { chromeRoot, firefoxRoot, attempts = 6, delayMs = 500 },
) => {
  const roots = [
    { dir: chromeRoot, prefix: "e2e-profile-" },
    { dir: firefoxRoot, prefix: "save-in-ff-e2e-" },
  ];
  /** @type {unknown[]} */
  const failures = [];
  for (const { dir, prefix } of roots) {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (
        entry.isDirectory() &&
        ownerIds.some((ownerId) => entry.name.startsWith(`${prefix}${ownerId}-`))
      ) {
        try {
          await removeWithRetries(path.join(dir, entry.name), { attempts, delayMs });
        } catch (error) {
          failures.push(error);
        }
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "E2E profile cleanup failed");
};

/**
 * Removes profiles left by interrupted harness processes while preserving any
 * profile whose owning PID is still alive.
 *
 * @param {{chromeRoot: string, firefoxRoot: string, attempts?: number, delayMs?: number}} options
 */
const pruneOrphanedProfiles = async ({ chromeRoot, firefoxRoot, attempts = 6, delayMs = 500 }) => {
  const roots = [
    { dir: chromeRoot, prefix: "e2e-profile-" },
    { dir: firefoxRoot, prefix: "save-in-ff-e2e-" },
  ];
  /** @type {unknown[]} */
  const failures = [];
  for (const { dir, prefix } of roots) {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
      const owner = entry.name.slice(prefix.length).match(/^(\d+)-(\d+)-/);
      const ownerPid = Number(owner?.[1]);
      const runStartedAt = Number(owner?.[2]);
      if (
        !Number.isInteger(ownerPid) ||
        !Number.isSafeInteger(runStartedAt) ||
        processOwnsRun(ownerPid, runStartedAt)
      ) {
        continue;
      }
      try {
        await removeWithRetries(path.join(dir, entry.name), { attempts, delayMs });
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length) throw new AggregateError(failures, "Orphaned E2E profile cleanup failed");
};

/** @param {string} artifacts @param {number} [keep] */
const pruneArtifactRuns = (artifacts, keep = 3) => {
  fs.mkdirSync(artifacts, { recursive: true });
  const entries = fs.readdirSync(artifacts, { withFileTypes: true });
  /** @type {Array<{path: string, mtime: number}>} */
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

/** @param {string} runRoot */
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
  pruneOrphanedProfiles,
  pruneRunDirectories,
  processOwnsRun,
  releaseDirectoryLock,
  removeOwnedProfiles,
  removeWithRetries,
  tryReclaimDirectoryLock,
};
