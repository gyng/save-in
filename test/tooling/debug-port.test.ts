import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const {
  CHROME_E2E_PORT_COUNT,
  CHROME_E2E_PORT_START,
  FIREFOX_E2E_PORT_COUNT,
  FIREFOX_E2E_PORT_START,
  releasePortLock,
  tryReclaimPortLock,
} = require("../../scripts/lib/debug-port.js") as {
  CHROME_E2E_PORT_COUNT: number;
  CHROME_E2E_PORT_START: number;
  FIREFOX_E2E_PORT_COUNT: number;
  FIREFOX_E2E_PORT_START: number;
  releasePortLock: (lock: string, token: string, port: number) => void;
  tryReclaimPortLock: (
    lock: string,
    options?: { orphanedAfterMs?: number; portIsBindable?: boolean },
  ) => boolean;
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

test("releases only the matching port-lease token", () => {
  const root = mkdtempSync(join(tmpdir(), "save-in-owned-port-lock-"));
  const lock = join(root, "9601");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.pid, token: "owner" }));

  try {
    expect(() => releasePortLock(lock, "contender", 9601)).toThrow("owned by another process");
    expect(() => releasePortLock(lock, "owner", 9601)).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows only the reclaim-marker owner to remove a stale port lease", () => {
  const root = mkdtempSync(join(tmpdir(), "save-in-port-lock-"));
  const lock = join(root, "9600");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner"), JSON.stringify({ pid: 999_999_999, token: "stale" }));
  mkdirSync(join(lock, ".reclaim"));

  try {
    expect(tryReclaimPortLock(lock, { portIsBindable: true })).toBe(false);
    rmSync(join(lock, ".reclaim"), { recursive: true });
    const stale = new Date(Date.now() - 3_000);
    utimesSync(lock, stale, stale);
    expect(tryReclaimPortLock(lock)).toBe(false);
    expect(tryReclaimPortLock(lock, { portIsBindable: true })).toBe(true);
    expect(() => mkdirSync(lock)).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
