import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { findFirefox, makeProfile, removeProfile } = require("../scripts/lib/firefox.js") as {
  findFirefox: () => string;
  makeProfile: (baseProfileDir: string) => { profileDir: string; downloadDir: string };
  removeProfile: (profileDir: string) => Promise<void>;
};

const originalFirefoxPath = process.env.FIREFOX_PATH;
const originalPath = process.env.PATH;
const originalE2ERunId = process.env.E2E_RUN_ID;

afterEach(() => {
  if (originalFirefoxPath === undefined) delete process.env.FIREFOX_PATH;
  else process.env.FIREFOX_PATH = originalFirefoxPath;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalE2ERunId === undefined) delete process.env.E2E_RUN_ID;
  else process.env.E2E_RUN_ID = originalE2ERunId;
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

  test("names disposable profiles for the outer E2E run", () => {
    const root = mkdtempSync(join(tmpdir(), "save-in-firefox-profile-"));
    process.env.E2E_RUN_ID = "runner-123";

    try {
      const { profileDir } = makeProfile(join(root, "save-in-ff-e2e"));
      expect(profileDir).toMatch(/save-in-ff-e2e-runner-123-\d+-[a-f\d]+$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("removes a disposable profile without a settling timer", async () => {
    const root = mkdtempSync(join(tmpdir(), "save-in-firefox-cleanup-"));
    const profile = join(root, "profile");
    writeFileSync(profile, "profile data");
    const timer = vi.spyOn(globalThis, "setTimeout");

    try {
      await removeProfile(root);
      expect(existsSync(root)).toBe(false);
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
