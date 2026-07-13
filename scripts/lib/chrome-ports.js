// @ts-check

const { CHROME_E2E_PORT_COUNT, CHROME_E2E_PORT_START } = require("./debug-port");

const CHROME_DEV_PORT = 9378;
const CHROME_DISCOVERY_PORTS = [
  9222,
  CHROME_DEV_PORT,
  ...Array.from({ length: CHROME_E2E_PORT_COUNT }, (_, index) => CHROME_E2E_PORT_START + index),
];

module.exports = { CHROME_DEV_PORT, CHROME_DISCOVERY_PORTS };
