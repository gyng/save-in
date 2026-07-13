import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { findFirefox } = require("../scripts/lib/firefox.js") as {
  findFirefox: () => string;
};

const originalFirefoxPath = process.env.FIREFOX_PATH;
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalFirefoxPath === undefined) delete process.env.FIREFOX_PATH;
  else process.env.FIREFOX_PATH = originalFirefoxPath;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
});

describe("isolated Firefox launcher", () => {
  test("finds a per-user Firefox installation through PATH", () => {
    const directory = mkdtempSync(join(tmpdir(), "save-in-firefox-path-"));
    const executable = join(directory, process.platform === "win32" ? "firefox.exe" : "firefox");
    writeFileSync(executable, "");
    chmodSync(executable, 0o755);
    delete process.env.FIREFOX_PATH;
    process.env.PATH = directory;

    try {
      expect(findFirefox()).toBe(executable);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
