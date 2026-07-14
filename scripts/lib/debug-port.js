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

/** @param {number} pid */
const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
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
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner"), String(process.pid));
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      try {
        const owner = Number(fs.readFileSync(path.join(lock, "owner"), "utf8"));
        if (!Number.isInteger(owner) || !processIsAlive(owner)) {
          const age = Date.now() - fs.statSync(lock).mtimeMs;
          if (Number.isInteger(owner) || age > 2000) {
            fs.rmSync(lock, { recursive: true, force: true });
            index -= 1;
          }
        }
      } catch {
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 2000) {
          fs.rmSync(lock, { recursive: true, force: true });
          index -= 1;
        }
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
        released = true;
        fs.rmSync(lock, { recursive: true, force: true });
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
  reserveAvailablePort,
};
