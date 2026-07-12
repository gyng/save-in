import { BROWSERS, detectCapabilities } from "../src/platform/chrome-detector.ts";

describe("detectCapabilities", () => {
  test("tabContextMenus supports Firefox and Chrome without requiring a runtime enum", () => {
    expect(detectCapabilities(BROWSERS.FIREFOX).tabContextMenus).toBe(true);
    const contextMenus = (global.chrome as any).contextMenus;
    try {
      (global.chrome as any).contextMenus = { ContextType: {} };
      expect(detectCapabilities(BROWSERS.CHROME).tabContextMenus).toBe(true);
    } finally {
      (global.chrome as any).contextMenus = contextMenus;
    }
  });

  test("access keys are supported everywhere (min versions >= 121)", () => {
    expect(detectCapabilities(BROWSERS.FIREFOX).accessKeys).toBe(true);
    expect(detectCapabilities(BROWSERS.CHROME).accessKeys).toBe(true);
  });

  test("normalizes browser-specific download semantics", () => {
    expect(detectCapabilities(BROWSERS.CHROME)).toMatchObject({
      downloadDeltaFilename: true,
      conflictActionPrompt: false,
    });
    expect(detectCapabilities(BROWSERS.FIREFOX)).toMatchObject({
      downloadDeltaFilename: false,
      conflictActionPrompt: true,
    });
  });

  test("filename routing follows the host API rather than the browser name", () => {
    const downloads = (global.chrome as any).downloads;
    const original = downloads.onDeterminingFilename;
    try {
      downloads.onDeterminingFilename = undefined;
      expect(detectCapabilities(BROWSERS.CHROME).downloadFilenameSuggestion).toBe(false);
      downloads.onDeterminingFilename = { addListener: vi.fn() };
      expect(detectCapabilities(BROWSERS.FIREFOX).downloadFilenameSuggestion).toBe(true);
    } finally {
      downloads.onDeterminingFilename = original;
    }
  });
});

// The module detects the browser as a side effect of being loaded (there is
// no init function to call), so each scenario below deletes/mutates the
// jest-webextension-mock browser global, resets the module registry, and
// re-imports a fresh copy to observe the detection logic run again.
describe("browser detection at load time", () => {
  const originalBrowser = global.browser;

  afterEach(() => {
    global.browser = originalBrowser;
    Reflect.deleteProperty(global.browser.runtime, "getBrowserInfo");
  });

  test("falls back to CHROME when there is no browser global but chrome exists (#no browser)", async () => {
    Reflect.deleteProperty(globalThis, "browser");
    vi.resetModules();

    const mod = await import("../src/platform/chrome-detector.ts");

    expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.CHROME);
  });

  test("stays UNKNOWN when neither browser nor chrome exist", async () => {
    const originalChrome = global.chrome;
    Reflect.deleteProperty(globalThis, "browser");
    Reflect.deleteProperty(globalThis, "chrome");
    vi.resetModules();

    try {
      const mod = await import("../src/platform/chrome-detector.ts");
      expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.UNKNOWN);
    } finally {
      global.chrome = originalChrome;
    }
  });

  test("detects FIREFOX immediately when getBrowserInfo exists, then parses the version async", async () => {
    global.browser = originalBrowser;
    (global.browser.runtime as any).getBrowserInfo = vi.fn(() =>
      Promise.resolve({ name: "Firefox", version: "121.0.1" }),
    );
    vi.resetModules();

    const mod = await import("../src/platform/chrome-detector.ts");

    // FIREFOX is decided synchronously, without waiting on getBrowserInfo()
    expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.FIREFOX);

    await vi.waitFor(() => expect(mod.CURRENT_BROWSER_VERSION).toBe(121.0));
  });

  test("treats Gecko forks (e.g. Waterfox) as FIREFOX regardless of the reported name (#186)", async () => {
    global.browser = originalBrowser;
    (global.browser.runtime as any).getBrowserInfo = vi.fn(() =>
      Promise.resolve({ name: "Waterfox", version: "6.0" }),
    );
    vi.resetModules();

    const mod = await import("../src/platform/chrome-detector.ts");

    expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.FIREFOX);

    await vi.waitFor(() => expect(mod.CURRENT_BROWSER_VERSION).toBe(6.0));
  });

  test("swallows a rejected getBrowserInfo() promise without throwing", async () => {
    global.browser = originalBrowser;
    global.browser.runtime.getBrowserInfo = vi.fn(() => Promise.reject(new Error("nope")));
    vi.resetModules();

    const mod = await import("../src/platform/chrome-detector.ts");

    expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.FIREFOX);

    await vi.waitFor(() => expect(global.browser.runtime.getBrowserInfo).toHaveBeenCalled());

    // Version stays unset; the rejection is swallowed, not thrown
    expect(mod.CURRENT_BROWSER_VERSION).toBeUndefined();
  });

  test("assumes CHROME when browser exists without getBrowserInfo", async () => {
    global.browser = originalBrowser;
    Reflect.deleteProperty(global.browser.runtime, "getBrowserInfo");
    vi.resetModules();

    const mod = await import("../src/platform/chrome-detector.ts");

    expect(mod.CURRENT_BROWSER).toBe(mod.BROWSERS.CHROME);
  });
});
