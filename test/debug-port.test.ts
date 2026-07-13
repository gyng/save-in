import { createServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CHROME_E2E_PORT_COUNT,
  CHROME_E2E_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  findAvailablePort,
} = require("../scripts/lib/debug-port.js") as {
  CHROME_E2E_PORT_COUNT: number;
  CHROME_E2E_PORT_START: number;
  FIREFOX_E2E_PORT_COUNT: number;
  FIREFOX_E2E_PORT_START: number;
  findAvailablePort: (
    start: number,
    count: number,
    options?: { host?: string; offset?: number },
  ) => Promise<number>;
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

test("skips a debug port that is already bound", async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const address = occupied.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");

  try {
    await expect(
      findAvailablePort(address.port, 1, { host: "127.0.0.1", offset: 0 }),
    ).rejects.toThrow(`No available debug port in ${address.port}-${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }

  await expect(findAvailablePort(address.port, 1, { host: "127.0.0.1", offset: 0 })).resolves.toBe(
    address.port,
  );
});
