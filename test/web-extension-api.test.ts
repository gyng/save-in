describe("webExtensionApi", () => {
  const originalBrowser = globalThis.browser;
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    globalThis.browser = originalBrowser;
    globalThis.chrome = originalChrome;
    vi.resetModules();
  });

  test("selects chrome when the native browser namespace is absent", async () => {
    delete globalThis.browser;
    const chromeApi = { runtime: { id: "chrome" } };
    globalThis.chrome = chromeApi as any;

    const { webExtensionApi } = await import("../src/web-extension-api.ts");

    expect(webExtensionApi).toBe(chromeApi);
    expect(globalThis.browser).toBeUndefined();
  });

  test("prefers Firefox's native browser namespace", async () => {
    const browserApi = { runtime: { id: "firefox" } };
    globalThis.browser = browserApi as any;
    globalThis.chrome = { runtime: { id: "chrome" } } as any;

    const { webExtensionApi } = await import("../src/web-extension-api.ts");

    expect(webExtensionApi).toBe(browserApi);
  });

  test("is undefined outside a WebExtension host", async () => {
    delete globalThis.browser;
    delete globalThis.chrome;

    const { webExtensionApi } = await import("../src/web-extension-api.ts");

    expect(webExtensionApi).toBeUndefined();
  });
});
