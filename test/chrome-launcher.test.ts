import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { chromeArgs, removeProfile } = require("../scripts/lib/chrome.js") as {
  chromeArgs: (profileDir: string, port: number, headless?: boolean) => string[];
  removeProfile: (profileDir: string) => Promise<void>;
};

describe("isolated Chrome launcher", () => {
  test("disables GPU caches that can outlive and break disposable profiles", () => {
    const args = chromeArgs("C:\\tmp\\profile", 9555);

    expect(args).toContain("--disable-gpu");
    expect(args).toContain("--remote-debugging-port=9555");
    expect(args).toContain("--user-data-dir=C:\\tmp\\profile");
  });

  test("adds headless mode only when requested", () => {
    expect(chromeArgs("profile", 9555, true)).toContain("--headless=new");
    expect(chromeArgs("profile", 9555, false)).not.toContain("--headless=new");
  });

  test("removes a disposable profile including downloaded files", async () => {
    const profile = mkdtempSync(join(tmpdir(), "save-in-chrome-cleanup-"));
    mkdirSync(join(profile, "downloads"));
    writeFileSync(join(profile, "downloads", "fixture.txt"), "fixture");

    await removeProfile(profile);

    expect(() => writeFileSync(join(profile, "still-there.txt"), "no")).toThrow();
  });
});
