import { options } from "../src/config/options-data.ts";
import { getExtensionFetchCredentials } from "../src/config/fetch-credentials.ts";
import { resolveDirectDownloadContext } from "../src/downloads/auth-context.ts";
import { setCurrentBrowser } from "../src/platform/chrome-detector.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installHostProperty } from "./webextension-test-helpers.ts";

test("declares cookie access as optional rather than install-time permission", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  expect(manifest.optional_permissions).toContain("cookies");
  expect(manifest.permissions).not.toContain("cookies");
});

describe("extension fetch credentials", () => {
  test("omits credentials unless the user enables them", () => {
    options.includeFetchCredentials = false;
    expect(getExtensionFetchCredentials()).toBe("omit");

    options.includeFetchCredentials = true;
    expect(getExtensionFetchCredentials()).toBe("include");
  });
});

describe("direct Firefox download context", () => {
  beforeEach(() => {
    setCurrentBrowser("FIREFOX");
    installHostProperty(global.browser, "permissions", {
      contains: vi.fn(() => Promise.resolve(false)),
    });
  });

  afterEach(() => {
    setCurrentBrowser("UNKNOWN");
    Reflect.deleteProperty(global.browser, "permissions");
  });

  test("preserves private context without exposing a cookie store", async () => {
    installHostProperty(
      global.browser.permissions,
      "contains",
      vi.fn(() => Promise.resolve(true)),
    );

    await expect(
      resolveDirectDownloadContext(
        { incognito: true, cookieStoreId: "firefox-private" },
        "https://example.com/file",
      ),
    ).resolves.toEqual({ incognito: true });
    expect(global.browser.permissions.contains).not.toHaveBeenCalled();
  });

  test("uses the originating Container only after optional permission is granted", async () => {
    installHostProperty(
      global.browser.permissions,
      "contains",
      vi.fn(() => Promise.resolve(true)),
    );

    await expect(
      resolveDirectDownloadContext(
        { incognito: false, cookieStoreId: "firefox-container-2" },
        "https://example.com/file",
      ),
    ).resolves.toEqual({ cookieStoreId: "firefox-container-2" });
    expect(global.browser.permissions.contains).toHaveBeenCalledWith({
      permissions: ["cookies"],
    });
  });

  test("keeps local Firefox downloads private but does not add Firefox context to Chrome", async () => {
    setCurrentBrowser("CHROME");
    await expect(
      resolveDirectDownloadContext(
        { incognito: true, cookieStoreId: "firefox-container-2" },
        "https://example.com/file",
      ),
    ).resolves.toEqual({});

    setCurrentBrowser("FIREFOX");
    await expect(
      resolveDirectDownloadContext(
        { incognito: true, cookieStoreId: "firefox-container-2" },
        "blob:local",
      ),
    ).resolves.toEqual({ incognito: true });
  });

  test("fails closed when permission state cannot be read", async () => {
    installHostProperty(
      global.browser.permissions,
      "contains",
      vi.fn(() => Promise.reject(new Error("unavailable"))),
    );

    await expect(
      resolveDirectDownloadContext(
        { cookieStoreId: "firefox-container-3" },
        "https://example.com/file",
      ),
    ).resolves.toEqual({});
  });
});
