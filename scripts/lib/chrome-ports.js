// @ts-check

const CHROME_DEV_PORT = 9378;
const CHROME_DISCOVERY_PORTS = [
  9222,
  CHROME_DEV_PORT,
  ...Array.from({ length: 400 }, (_, index) => 9400 + index),
];

module.exports = { CHROME_DEV_PORT, CHROME_DISCOVERY_PORTS };
