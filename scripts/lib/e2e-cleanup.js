// @ts-check

const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const DIRECTORY_LOCK_ORPHANED_AFTER_MS = 30 * 60_000;
const ABANDONED_RUN_AFTER_MS = 24 * 60 * 60_000;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @param {number} ms */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {unknown} error @returns {string | undefined} */
const errorCode = (error) =>
  error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

/**
 * Claims stale-lock cleanup with an exclusive marker inside the lock. A
 * contender that does not own the marker must leave the directory untouched.
 *
 * @param {string} lockDir
 * @param {{orphanedAfterMs?: number, pid?: number}} [options]
 */
const tryReclaimDirectoryLock = (
  lockDir,
  { orphanedAfterMs = DIRECTORY_LOCK_ORPHANED_AFTER_MS, pid = process.pid } = {},
) => {
  let observedMtime;
  try {
    observedMtime = fs.statSync(lockDir).mtimeMs;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
  // PID liveness is not comparable across sandbox namespaces. Treat the lock
  // as a bounded lease instead: even a valid owner becomes reclaimable only
  // after a duration far beyond a normal build. Check age before creating the
  // claim marker because child churn updates the directory mtime.
  if (Date.now() - observedMtime <= orphanedAfterMs) return false;

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
  const token = crypto.randomBytes(16).toString("hex");
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

/**
 * Removes resources whose active marker has exceeded the maximum supported
 * run duration. Fresh markers remain authoritative across PID namespaces.
 *
 * @param {{artifacts: string, runRoot: string, chromeRoot: string, firefoxRoot: string, orphanedAfterMs?: number, now?: number, attempts?: number, delayMs?: number}} options
 */
const cleanupAbandonedRuns = async ({
  artifacts,
  runRoot,
  chromeRoot,
  firefoxRoot,
  orphanedAfterMs = ABANDONED_RUN_AFTER_MS,
  now = Date.now(),
  attempts = 2,
  delayMs = 100,
}) => {
  /** @type {string[]} */
  const abandonedRunIds = [];
  for (const entry of fs.existsSync(artifacts)
    ? fs.readdirSync(artifacts, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runId = entry.name.slice("run-".length);
    if (!runId || !/^[a-z0-9_-]+$/i.test(runId)) continue;
    const marker = path.join(artifacts, entry.name, ".active");
    let markerAge;
    let markerOwner;
    try {
      markerAge = now - fs.statSync(marker).mtimeMs;
      markerOwner = fs.readFileSync(marker, "utf8").trim();
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
    const ownsRun =
      markerOwner === runId || (/^\d+$/.test(markerOwner) && runId.startsWith(`${markerOwner}-`));
    if (ownsRun && markerAge > orphanedAfterMs) abandonedRunIds.push(runId);
  }

  /** @type {unknown[]} */
  const failures = [];
  /** @type {string[]} */
  const cleanedRunIds = [];
  for (const runId of abandonedRunIds) {
    /** @type {unknown[]} */
    const runFailures = [];
    try {
      await removeOwnedProfiles([runId], {
        chromeRoot,
        firefoxRoot,
        attempts,
        delayMs,
      });
    } catch (error) {
      runFailures.push(error);
    }
    try {
      fs.rmSync(path.join(runRoot, runId), { recursive: true, force: true });
    } catch (error) {
      runFailures.push(error);
    }
    if (runFailures.length === 0) {
      fs.rmSync(path.join(artifacts, `run-${runId}`, ".active"), { force: true });
      cleanedRunIds.push(runId);
    } else {
      failures.push(...runFailures);
    }
  }
  return { cleanedRunIds, failures };
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
    // A PID from another sandbox namespace can look dead here. Preserve every
    // active marker; only the owning runner removes it after cleanup.
    if (fs.existsSync(marker)) continue;
    runs.push({ path: runPath, mtime });
  }
  const sortedRuns = runs.toSorted((a, b) => b.mtime - a.mtime);
  for (const oldRun of sortedRuns.slice(keep)) {
    fs.rmSync(oldRun.path, { recursive: true, force: true });
  }
};

module.exports = {
  ABANDONED_RUN_AFTER_MS,
  DIRECTORY_LOCK_ORPHANED_AFTER_MS,
  acquireDirectoryLock,
  cleanupAbandonedRuns,
  pruneArtifactRuns,
  releaseDirectoryLock,
  removeOwnedProfiles,
  removeWithRetries,
  tryReclaimDirectoryLock,
};
