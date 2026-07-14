import { options } from "../../src/config/options-data.ts";
import { getExtensionFetchCredentials } from "../../src/config/fetch-credentials.ts";
import { resolveFirefoxDownloadContext } from "../../src/downloads/auth-context.ts";
import { setCurrentBrowser } from "../../src/platform/chrome-detector.ts";

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
  });

  afterEach(() => {
    setCurrentBrowser("UNKNOWN");
  });

  test("preserves private context without selecting a cookie store", async () => {
    await expect(
      resolveFirefoxDownloadContext({ incognito: true, cookieStoreId: "firefox-private" }),
    ).resolves.toEqual({ incognito: true });
  });

  test("keeps local Firefox downloads private but adds no Firefox context to Chrome", async () => {
    setCurrentBrowser("CHROME");
    await expect(
      resolveFirefoxDownloadContext({
        incognito: true,
        cookieStoreId: "firefox-container-2",
      }),
    ).resolves.toEqual({});

    setCurrentBrowser("FIREFOX");
    await expect(
      resolveFirefoxDownloadContext({ incognito: true, cookieStoreId: "firefox-private" }),
    ).resolves.toEqual({ incognito: true });
  });

  test("ignores a non-private Container store", async () => {
    await expect(
      resolveFirefoxDownloadContext({ cookieStoreId: "firefox-container-3" }),
    ).resolves.toEqual({});
  });
});
