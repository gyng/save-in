import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CHROME_E2E_PORT_COUNT,
  CHROME_E2E_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
} = require("../../scripts/lib/debug-port.js") as {
  CHROME_E2E_PORT_COUNT: number;
  CHROME_E2E_PORT_START: number;
  FIREFOX_E2E_PORT_COUNT: number;
  FIREFOX_E2E_PORT_START: number;
};

test("assigns Chrome and Firefox disjoint E2E debug-port ranges", () => {
  const chromePorts = new Set(
    Array.from({ length: CHROME_E2E_PORT_COUNT }, (_, index) => CHROME_E2E_PORT_START + index),
  );
  const firefoxPorts = Array.from(
    { length: FIREFOX_E2E_PORT_COUNT },
    (_, index) => FIREFOX_E2E_PORT_START + index,
  );

  expect(firefoxPorts.some((port) => chromePorts.has(port))).toBe(false);
});
