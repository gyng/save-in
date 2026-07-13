import { readFileSync } from "node:fs";
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
    expect(read("test/globals.d.ts")).not.toContain("optionErrors");
  });

  test("keeps the e2e bridge command-oriented", () => {
    const entry = read("src/entries/background.ts");
    expect(entry).toContain("createBackgroundE2EApi()");
    expect(entry).not.toMatch(/installBackgroundE2EBridge\(globalThis, \{[\s\S]*?\}\);/);

    for (const path of ["e2e/chrome.e2e.mjs", "e2e/firefox.e2e.mjs"]) {
      const harness = read(path);
      expect(harness).not.toContain("runtime: window");
      expect(harness).not.toMatch(/\b(Log|SaveHistory|Download|Notifier|Messaging|options),/);
    }
  });
});
