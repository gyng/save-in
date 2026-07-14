import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CHROME_DEV_PORT, CHROME_DISCOVERY_PORTS } =
  require("../../scripts/lib/chrome-ports.js") as {
    CHROME_DEV_PORT: number;
    CHROME_DISCOVERY_PORTS: number[];
  };

test("reload discovery includes the fixed Chrome development port", () => {
  expect(CHROME_DEV_PORT).toBe(9378);
  expect(CHROME_DISCOVERY_PORTS).toContain(CHROME_DEV_PORT);
  expect(CHROME_DISCOVERY_PORTS).toContain(9222);
  expect(CHROME_DISCOVERY_PORTS).toContain(9600);
  expect(CHROME_DISCOVERY_PORTS).toContain(9799);
  expect(CHROME_DISCOVERY_PORTS).not.toContain(9599);
});
