import { createRequire } from "node:module";
import { createServer } from "node:net";
import { closeServer, listenOnLoopback } from "./server.ts";

const require = createRequire(import.meta.url);
const { findAvailablePort } = require("../../scripts/lib/debug-port.js") as {
  findAvailablePort: (
    start: number,
    count: number,
    options?: { host?: string; offset?: number },
  ) => Promise<number>;
};

test("skips a debug port that is already bound", async () => {
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
