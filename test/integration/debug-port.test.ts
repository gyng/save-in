import { createRequire } from "node:module";
import { createServer } from "node:net";
import { closeServer, listenOnLoopback } from "./server.ts";

const require = createRequire(import.meta.url);
const { CHROME_E2E_PORT_COUNT, CHROME_E2E_PORT_START, findAvailablePort } =
  require("../../scripts/lib/debug-port.js") as {
    CHROME_E2E_PORT_COUNT: number;
    CHROME_E2E_PORT_START: number;
    findAvailablePort: (
      start: number,
      count: number,
      options?: { host?: string; offset?: number },
    ) => Promise<number>;
  };

test("rejects a debug-port range when its only port is already bound", async () => {
  const occupied = createServer();
  const { port } = await listenOnLoopback(occupied);

  try {
    await expect(findAvailablePort(port, 1, { host: "127.0.0.1", offset: 0 })).rejects.toThrow(
      `No available debug port in ${port}-${port}`,
    );
  } finally {
    await closeServer(occupied);
  }

  await expect(findAvailablePort(port, 1, { host: "127.0.0.1", offset: 0 })).resolves.toBe(port);
});

test("skips an occupied debug port and selects a later port in the range", async () => {
  const firstAvailable = await findAvailablePort(CHROME_E2E_PORT_START, CHROME_E2E_PORT_COUNT, {
    host: "127.0.0.1",
    offset: 0,
  });
  const occupied = createServer();
  await listenOnLoopback(occupied, firstAvailable);

  try {
    const remainingCount = CHROME_E2E_PORT_START + CHROME_E2E_PORT_COUNT - firstAvailable;
    const selected = await findAvailablePort(firstAvailable, remainingCount, {
      host: "127.0.0.1",
      offset: 0,
    });

    expect(selected).toBeGreaterThan(firstAvailable);
    expect(selected).toBeLessThan(CHROME_E2E_PORT_START + CHROME_E2E_PORT_COUNT);
  } finally {
    await closeServer(occupied);
  }
});
