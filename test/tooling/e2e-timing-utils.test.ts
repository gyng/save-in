import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeTimingModuleId, timingBrowserForModule } =
  require("../../scripts/e2e-timing-utils.js") as {
    normalizeTimingModuleId: (moduleId: string) => string;
    timingBrowserForModule: (moduleId: string) => string;
  };

test("normalizes machine-specific module roots", () => {
  expect(normalizeTimingModuleId("/home/runner/repo/test/e2e/chrome/downloads.e2e.mjs")).toBe(
    "test/e2e/chrome/downloads.e2e.mjs",
  );
  expect(normalizeTimingModuleId("C:\\repo\\test\\e2e\\firefox.e2e.mjs")).toBe(
    "test/e2e/firefox.e2e.mjs",
  );
});

test("classifies both monolithic and directory-split browser suites", () => {
  expect(timingBrowserForModule("test/e2e/chrome.e2e.mjs")).toBe("chrome");
  expect(timingBrowserForModule("test/e2e/firefox/history.e2e.mjs")).toBe("firefox");
  expect(timingBrowserForModule("test/e2e/shared.e2e.mjs")).toBe("unknown");
});
