import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { killTree } = require("../../scripts/lib/chrome.js") as {
  killTree: (process: ReturnType<typeof spawn>) => Promise<void>;
};

test("terminates an owned browser process", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });

  try {
    await killTree(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
