import fs, { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildOutputForMode,
  chromeArgs,
  findChrome,
  parseChromeMajorVersion,
  relaunchIfCdpNeverOpened,
  removeProfile,
} = require("../../scripts/lib/chrome.js") as {
  buildOutputForMode: (mode?: "production" | "e2e") => string;
  chromeArgs: (
    profileDir: string,
    port: number,
    headless?: boolean,
    noSandbox?: boolean,
    legacyExtensionDir?: string,
    disableGpu?: boolean,
    extraArgs?: string[],
  ) => string[];
  findChrome: () => string;
  parseChromeMajorVersion: (version: string) => number;
  removeProfile: (profileDir: string) => Promise<void>;
  relaunchIfCdpNeverOpened: <T>(
    launchOnce: () => Promise<T>,
    options?: { attempts?: number; log?: (message: string) => void },
  ) => Promise<T>;
};

// The shape launchOnce reports: its startup error wraps the CDP wait's error.
const startupFailure = (message: string) =>
  new Error(`${message}\nChrome process: still running`, { cause: new Error(message) });

const originalChromePath = process.env.CHROME_PATH;
const originalPath = process.env.PATH;

afterEach(() => {
  if (originalChromePath === undefined) delete process.env.CHROME_PATH;
  else process.env.CHROME_PATH = originalChromePath;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
});

describe("isolated Chrome launcher", () => {
  test("relaunches once when Chrome never opens its CDP port", async () => {
    const log = vi.fn();
    let calls = 0;
    const session = await relaunchIfCdpNeverOpened(
      async () => {
        calls += 1;
        if (calls === 1) throw startupFailure("Chrome did not open CDP port 9737");
        return "session";
      },
      { log },
    );

    expect(session).toBe("session");
    expect(calls).toBe(2);
    expect(log).toHaveBeenCalledOnce();
  });

  test("reports a repeated hang and never relaunches other startup failures", async () => {
    const hang = startupFailure("Chrome did not open CDP port 9737");
    let hangs = 0;
    await expect(
      relaunchIfCdpNeverOpened(
        async () => {
          hangs += 1;
          throw hang;
        },
        { log: () => {} },
      ),
    ).rejects.toBe(hang);
    expect(hangs).toBe(2);

    const invalidPackage = startupFailure("Extensions.loadUnpacked failed");
    let loads = 0;
    await expect(
      relaunchIfCdpNeverOpened(async () => {
        loads += 1;
        throw invalidPackage;
      }),
    ).rejects.toBe(invalidPackage);
    expect(loads).toBe(1);
  });

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

  test("allows a persistent inference profile to keep GPU acceleration", () => {
    expect(chromeArgs("profile", 9555, false, false, undefined, false)).not.toContain(
      "--disable-gpu",
    );
  });

  test("adds caller-owned graphics arguments before the initial URL", () => {
    const args = chromeArgs("profile", 9555, false, false, undefined, false, ["--use-angle=gl"]);

    expect(args.slice(-2)).toEqual(["--use-angle=gl", "about:blank"]);
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
    expect(parseChromeMajorVersion("Google Chrome for Testing 149.0.7827.55")).toBe(149);
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
});
