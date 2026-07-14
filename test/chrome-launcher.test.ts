import fs, { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildOutputForMode,
  chromeArgs,
  findChrome,
  killTree,
  parseChromeMajorVersion,
  removeProfile,
} = require("../scripts/lib/chrome.js") as {
  buildOutputForMode: (mode?: "production" | "e2e") => string;
  chromeArgs: (
    profileDir: string,
    port: number,
    headless?: boolean,
    noSandbox?: boolean,
    legacyExtensionDir?: string,
  ) => string[];
  findChrome: () => string;
  killTree: (process: ReturnType<typeof spawn>) => Promise<void>;
  parseChromeMajorVersion: (version: string) => number;
  removeProfile: (profileDir: string) => Promise<void>;
};

const originalChromePath = process.env.CHROME_PATH;
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalChromePath === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = originalChromePath;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
});

describe("isolated Chrome launcher", () => {
  test("selects the staged package that matches the requested build mode", () => {
    expect(buildOutputForMode()).toMatch(/[\\/]dist[\\/]bundled-pkg$/);
    expect(buildOutputForMode("e2e")).toMatch(/[\\/]dist[\\/]bundled-pkg-e2e$/);
  });

  test("disables GPU caches that can outlive and break disposable profiles", () => {
    const args = chromeArgs("C:\\tmp\\profile", 9555);

    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--remote-debugging-port=9555");
    expect(args).toContain("--user-data-dir=C:\\tmp\\profile");
  });

  test("disables Chrome's sandbox only when an outer sandbox requires it", () => {
    expect(chromeArgs("profile", 9555)).not.toContain("--no-sandbox");
    expect(chromeArgs("profile", 9555, false, true)).toContain("--no-sandbox");
  });

  test("adds headless mode only when requested", () => {
    expect(chromeArgs("profile", 9555, true)).toContain("--headless=new");
    expect(chromeArgs("profile", 9555, false)).not.toContain("--headless=new");
  });

  test("finds a per-user Chrome installation through PATH", () => {
    const directory = mkdtempSync(join(tmpdir(), "save-in-chrome-path-"));
    const executable = join(
      directory,
      process.platform === "win32" ? "google-chrome.exe" : "google-chrome",
    );
    writeFileSync(executable, "");
    chmodSync(executable, 0o755);
    delete process.env.CHROME_PATH;
    process.env.PATH = directory;

    try {
      expect(findChrome()).toBe(executable);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("parses the Chrome major version used to choose an extension loading strategy", () => {
    expect(parseChromeMajorVersion("Google Chrome 150.0.7871.114")).toBe(150);
    expect(() => parseChromeMajorVersion("not Chrome")).toThrow(
      "Unable to determine Chrome version",
    );
  });

  test("loads unpacked extensions through a launch argument on Chrome before 137", () => {
    expect(chromeArgs("profile", 9555, true, false, "/tmp/extension")).toContain(
      "--load-extension=/tmp/extension",
    );
    expect(chromeArgs("profile", 9555, true)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^--load-extension=/)]),
    );
  });

  test("removes a disposable profile including downloaded files", async () => {
    const profile = mkdtempSync(join(tmpdir(), "save-in-chrome-cleanup-"));
    mkdirSync(join(profile, "downloads"));
    writeFileSync(join(profile, "downloads", "fixture.txt"), "fixture");

    const timer = vi.spyOn(globalThis, "setTimeout");

    try {
      await removeProfile(profile);
      expect(() => writeFileSync(join(profile, "still-there.txt"), "no")).toThrow();
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
    }
  });

  test("retries profile removal on later event-loop turns without a settling timer", async () => {
    const profile = mkdtempSync(join(tmpdir(), "save-in-chrome-cleanup-race-"));
    const realRmSync = fs.rmSync;
    const remove = vi.spyOn(fs, "rmSync").mockImplementationOnce((target, options) => {
      realRmSync(target, options);
      mkdirSync(profile);
    });
    const timer = vi.spyOn(globalThis, "setTimeout");

    try {
      await removeProfile(profile);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(timer).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
      remove.mockRestore();
      rmSync(profile, { recursive: true, force: true });
    }
  });

  test("terminates the owned browser process when tree termination is unavailable", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    await killTree(child);

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
