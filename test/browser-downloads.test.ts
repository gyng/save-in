import { Path } from "../src/routing/path.ts";
import {
  createBrowserDownloadState,
  isOrdinaryBrowserDownload,
  isReroutableBrowserDownload,
  matchesBrowserDownloadFilter,
  routeBrowserDownload,
} from "../src/downloads/browser-downloads.ts";

describe("ordinary browser download ownership", () => {
  test("accepts browser-owned downloads and excludes every extension", () => {
    expect(isOrdinaryBrowserDownload({}, "save-in")).toBe(true);
    expect(isOrdinaryBrowserDownload({ byExtensionId: "save-in" }, "save-in")).toBe(false);
    expect(isOrdinaryBrowserDownload({ byExtensionId: "other" }, "save-in")).toBe(false);
  });
});

test("Firefox replacement routing accepts only HTTP(S) downloads", () => {
  expect(isReroutableBrowserDownload({ url: "https://example.com/a", filename: "a" })).toBe(true);
  expect(isReroutableBrowserDownload({ url: "blob:private", filename: "a" })).toBe(false);
  expect(isReroutableBrowserDownload({ url: "data:text/plain,x", filename: "a" })).toBe(false);
});

describe("browser download URL filter", () => {
  test("blank means every ordinary download", () => {
    expect(matchesBrowserDownloadFilter("https://example.com/file.zip", "")).toBe(true);
  });

  test("supports domains, subdomains, paths, and multiple patterns", () => {
    const filter = "*://*.example.com/files/*\nhttps://downloads.test/*";
    expect(matchesBrowserDownloadFilter("https://cdn.example.com/files/a.zip", filter)).toBe(true);
    expect(matchesBrowserDownloadFilter("https://downloads.test/a.zip", filter)).toBe(true);
    expect(matchesBrowserDownloadFilter("https://cdn.example.com/other/a.zip", filter)).toBe(false);
  });

  test("a nonblank invalid filter matches nothing", () => {
    expect(matchesBrowserDownloadFilter("https://example.com/a.zip", "not a pattern")).toBe(false);
  });

  test("exclusions override both blank and matching include filters", () => {
    const excluded = "*://private.example.com/*";
    expect(matchesBrowserDownloadFilter("https://private.example.com/a.zip", "", excluded)).toBe(
      false,
    );
    expect(
      matchesBrowserDownloadFilter(
        "https://private.example.com/a.zip",
        "*://*.example.com/*",
        excluded,
      ),
    ).toBe(false);
    expect(
      matchesBrowserDownloadFilter(
        "https://public.example.com/a.zip",
        "*://*.example.com/*",
        excluded,
      ),
    ).toBe(true);
  });
});

describe("browser download routing", () => {
  const item = {
    id: 12,
    url: "https://cdn.example/files/cat.jpg",
    filename: "C:\\Users\\me\\Downloads\\cat.jpg",
  };

  test("builds the deliberately reduced routing state", () => {
    const state = createBrowserDownloadState(item as any);
    expect(state.path).toBeInstanceOf(Path);
    expect(state.info).toMatchObject({
      url: item.url,
      filename: "cat.jpg",
      suggestedFilename: "cat.jpg",
      initialFilename: "cat.jpg",
      context: "browser",
    });
    expect(state.info.pageUrl).toBeUndefined();
  });

  test("leaves unmatched downloads untouched", async () => {
    const download = {
      getRoutingMatches: vi.fn(() => null),
      finalizeFullPath: vi.fn(),
    };
    await expect(routeBrowserDownload(download as any, item as any)).resolves.toBeNull();
    expect(download.finalizeFullPath).not.toHaveBeenCalled();
  });

  test("returns the finalized filename for a matching rule", async () => {
    const download = {
      getRoutingMatches: vi.fn(() => "browser/:filename:"),
      finalizeFullPath: vi.fn(() => "browser/cat.jpg"),
    };
    await expect(routeBrowserDownload(download as any, item as any)).resolves.toBe(
      "browser/cat.jpg",
    );
    expect(download.finalizeFullPath).toHaveBeenCalledOnce();
  });
});
