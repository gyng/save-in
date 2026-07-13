// @ts-check

const net = require("net");

const CHROME_E2E_PORT_START = 9600;
const CHROME_E2E_PORT_COUNT = 200;
const FIREFOX_E2E_PORT_START = 9380;
const FIREFOX_E2E_PORT_COUNT = 200;

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

module.exports = {
  CHROME_E2E_PORT_COUNT,
  CHROME_E2E_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  findAvailablePort,
};
