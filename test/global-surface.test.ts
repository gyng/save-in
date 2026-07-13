import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("application global surface", () => {
  test("does not emulate Window inside the service worker", () => {
    expect(read("rolldown.config.mjs")).not.toContain("self.window = self");
  });

  test("keeps background runtime state in its module", () => {
    expect(read("src/background/runtime.ts")).not.toContain(
      'Symbol.for("save-in.backgroundRuntime")',
    );
  });

  test("does not use Window as an options-module message bus", () => {
    expect(read("src/options/options.ts")).not.toContain("window.confirmPendingChanges");
    expect(read("src/options/tabs.ts")).not.toContain("window.confirmPendingChanges");
    expect(read("types/platform.d.ts")).not.toContain("confirmPendingChanges");
  });

  test("does not retain migration-era test globals", () => {
    for (const path of [
      "test/content-disposition.test.ts",
      "test/option.test.ts",
      "test/rule-builder.test.ts",
    ]) {
      expect(read(path)).not.toContain("Object.assign(global, constants)");
    }
    expect(read("test/rule-builder.test.ts")).not.toContain("window.optionErrors");
    expect(read("test/path-editor.test.ts")).not.toContain(
      'Reflect.set(globalThis, "renderMenuPreview"',
    );
    expect(existsSync(resolve("test/globals.d.ts"))).toBe(false);
  });

  test("keeps e2e controls off the browser global", () => {
    const entry = read("src/entries/background.ts");
    const e2eEntry = read("src/entries/background.e2e.ts");
    expect(entry).not.toContain("registerBackgroundE2ECommand");
    expect(e2eEntry).toContain("registerBackgroundE2ECommand()");
    expect(e2eEntry).not.toContain("globalThis");
    expect(read("rolldown.config.mjs")).not.toContain("SAVE_IN_E2E");
    expect(read("scripts/build-bundled.js")).toContain("assertBackgroundControlSurface");

    for (const path of ["e2e/chrome.e2e.mjs", "e2e/firefox.e2e.mjs"]) {
      const harness = read(path);
      expect(harness).not.toContain("__SAVE_IN_E2E__");
      expect(harness).not.toContain("runtime: window");
      expect(harness).not.toMatch(/\b(Log|SaveHistory|Download|Notifier|Messaging|options),/);
    }
  });

  test("keeps the content panel closed outside explicit e2e builds", () => {
    const bundler = read("rolldown.config.mjs");
    const staging = read("scripts/build-bundled.js");

    expect(bundler).toContain("SAVE_IN_CONTENT_E2E");
    expect(staging).toContain("Unexpected content panel shadow mode");
  });

  test("gives the options entry sole DOM-ready ownership", () => {
    expect(read("src/entries/options.ts")).toMatch(/addEventListener\(\s*"DOMContentLoaded"/);
    for (const path of [
      "src/options/l10n.ts",
      "src/options/history-panel.ts",
      "src/options/option-search.ts",
      "src/options/options-reference.ts",
      "src/options/path-editor.ts",
      "src/options/permissions-banner.ts",
      "src/options/rule-builder.ts",
      "src/options/source-shortcut.ts",
      "src/options/options-bootstrap.ts",
    ]) {
      expect(read(path)).not.toContain('addEventListener("DOMContentLoaded"');
    }
  });

  test("keeps package templates aligned with generated bundle paths", () => {
    const manifest = JSON.parse(read("manifest.json"));
    expect(manifest.background).toEqual({
      scripts: ["background.js"],
      service_worker: "background.sw.js",
    });
    expect(manifest.content_scripts[0].js).toEqual(["content.js"]);
    expect(read("src/options/options.html").match(/<script[^>]+src=/g)).toHaveLength(1);
    expect(read("src/options/options.html")).toContain('src="../../options.js"');
  });
});
