describe("browser-shim", () => {
  let originalBrowser;
  let originalChrome;

  beforeEach(() => {
    vi.resetModules();
    originalBrowser = globalThis.browser;
    originalChrome = globalThis.chrome;
  });

  afterEach(() => {
    globalThis.browser = originalBrowser;
    globalThis.chrome = originalChrome;
  });

  test("aliases browser to chrome when browser is missing (Chrome)", async () => {
    delete globalThis.browser;
    globalThis.chrome = { runtime: { id: "x" } };

    await import("../src/browser-shim.ts");

    expect(globalThis.browser).toBe(globalThis.chrome);
  });

  test("leaves the native browser global alone (Firefox)", async () => {
    const nativeBrowser = { runtime: { id: "native" } };
    globalThis.browser = nativeBrowser;
    globalThis.chrome = { runtime: { id: "chrome-ns" } };

    await import("../src/browser-shim.ts");

    expect(globalThis.browser).toBe(nativeBrowser);
  });
});
