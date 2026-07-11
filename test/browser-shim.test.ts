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
    (globalThis as any).chrome = { runtime: { id: "x" } };

    // browser-shim.ts is a global script by design (no bundler, shared
    // scope): it has no import/export statements, so TS can't type a
    // dynamic import of it as a module
    // @ts-expect-error
    await import("../src/browser-shim.ts");

    expect(globalThis.browser).toBe(globalThis.chrome);
  });

  test("leaves the native browser global alone (Firefox)", async () => {
    const nativeBrowser = { runtime: { id: "native" } };
    (globalThis as any).browser = nativeBrowser;
    (globalThis as any).chrome = { runtime: { id: "chrome-ns" } };

    // @ts-expect-error — see note above
    await import("../src/browser-shim.ts");

    expect(globalThis.browser).toBe(nativeBrowser);
  });
});
