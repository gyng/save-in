// @ts-check

const net = require("net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME_E2E_PORT_START = 9600;
const CHROME_E2E_PORT_COUNT = 200;
const FIREFOX_E2E_PORT_START = 9380;
const FIREFOX_E2E_PORT_COUNT = 200;
const FIREFOX_BIDI_PORT_START = 9080;
const FIREFOX_BIDI_PORT_COUNT = 200;
const PORT_LOCK_ROOT = path.join(os.tmpdir(), "save-in-e2e-ports");

/** @param {string} lock */
const readPortOwner = (lock) => {
  const stored = fs.readFileSync(path.join(lock, "owner"), "utf8");
  try {
    const parsed = JSON.parse(stored);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.token === "string"
    ) {
      return { pid: parsed.pid, token: parsed.token };
    }
  } catch {
    // Older harnesses wrote a plain PID. Keep those locks reclaimable.
  }
  const pid = Number(stored);
  return Number.isInteger(pid) ? { pid, token: undefined } : undefined;
};

/**
 * @param {string} lock
 * @param {{orphanedAfterMs?: number, portIsBindable?: boolean}} [options]
 */
const tryReclaimPortLock = (lock, { orphanedAfterMs = 2_000, portIsBindable = false } = {}) => {
  let observedMtime;
  try {
    observedMtime = fs.statSync(lock).mtimeMs;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
  // Avoid touching a fresh lock or one whose browser still owns the port.
  // Claim-marker churn changes the directory mtime.
  if (!portIsBindable || Date.now() - observedMtime <= orphanedAfterMs) return false;
  const claim = path.join(lock, ".reclaim");
  try {
    fs.mkdirSync(claim);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "ENOENT")
    ) {
      return false;
    }
    throw error;
  }
  let removed = false;
  try {
    // PID liveness is not comparable across sandbox namespaces. A lock is
    // reclaimable only when its port is actually free and the lease is old
    // enough to be past the check-to-browser-bind startup window.
    fs.rmSync(lock, { recursive: true, force: true });
    removed = true;
    return true;
  } finally {
    if (!removed) fs.rmSync(claim, { recursive: true, force: true });
  }
};

/** @param {string} lock @param {string} token @param {number} port */
const releasePortLock = (lock, token, port) => {
  let owner;
  try {
    owner = readPortOwner(lock);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (owner?.token !== token) {
    throw new Error(`Refusing to release a debug port owned by another process: ${port}`);
  }
  fs.rmSync(lock, { recursive: true, force: true });
};

/** @param {number} port @param {string} host @returns {Promise<boolean>} */
const canBind = (port, host) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });

/**
 * Finds a bindable port in a browser-specific range. Chrome and Firefox use
 * disjoint ranges so their parallel CI launches cannot select the same port.
 *
 * @param {number} start
 * @param {number} count
 * @param {{host?: string, offset?: number}} [options]
 */
const findAvailablePort = async (
  start,
  count,
  { host = "127.0.0.1", offset = Math.floor(Math.random() * count) } = {},
) => {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    !Number.isInteger(offset) ||
    count < 1
  ) {
    throw new TypeError("Debug port range must contain at least one integer port");
  }
  const normalizedOffset = ((offset % count) + count) % count;
  for (let index = 0; index < count; index += 1) {
    const port = start + ((normalizedOffset + index) % count);
    if (await canBind(port, host)) return port;
  }
  throw new Error(`No available debug port in ${start}-${start + count - 1}`);
};

/**
 * Atomically leases a debug port across concurrent Save In runs. The browser
 * still performs the real bind; the lease closes the check-then-launch race
 * between our own harness processes.
 *
 * @param {number} start
 * @param {number} count
 * @param {{host?: string, offset?: number}} [options]
 */
const reserveAvailablePort = async (
  start,
  count,
  { host = "127.0.0.1", offset = Math.floor(Math.random() * count) } = {},
) => {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(count) ||
    !Number.isInteger(offset) ||
    count < 1
  ) {
    throw new TypeError("Debug port range must contain at least one integer port");
  }
  fs.mkdirSync(PORT_LOCK_ROOT, { recursive: true });
  const normalizedOffset = ((offset % count) + count) % count;
  for (let index = 0; index < count; index += 1) {
    const port = start + ((normalizedOffset + index) % count);
    const lock = path.join(PORT_LOCK_ROOT, String(port));
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let created = false;
    try {
      fs.mkdirSync(lock);
      created = true;
      fs.writeFileSync(path.join(lock, "owner"), JSON.stringify({ pid: process.pid, token }));
    } catch (error) {
      if (created) fs.rmSync(lock, { recursive: true, force: true });
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      if ((await canBind(port, host)) && tryReclaimPortLock(lock, { portIsBindable: true })) {
        index -= 1;
      }
      continue;
    }
    if (!(await canBind(port, host))) {
      fs.rmSync(lock, { recursive: true, force: true });
      continue;
    }
    let released = false;
    return {
      port,
      release: () => {
        if (released) return;
        releasePortLock(lock, token, port);
        released = true;
      },
    };
  }
  throw new Error(`No available debug port lease in ${start}-${start + count - 1}`);
};

module.exports = {
  CHROME_E2E_PORT_COUNT,
  CHROME_E2E_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  FIREFOX_BIDI_PORT_COUNT,
  FIREFOX_BIDI_PORT_START,
  findAvailablePort,
  releasePortLock,
  reserveAvailablePort,
  tryReclaimPortLock,
};
