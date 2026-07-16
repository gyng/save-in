import { Path } from "../../src/routing/path.ts";
import { matchRules, parseRules } from "../../src/routing/router.ts";
import {
  BrowserDownloadRouting,
  createBrowserDownloadState,
  isOrdinaryBrowserDownload,
  isReroutableBrowserDownload,
  matchesBrowserDownloadFilter,
  routeBrowserDownload,
} from "../../src/downloads/browser-downloads.ts";

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
  expect(isReroutableBrowserDownload({ url: "not a URL", filename: "a" })).toBe(false);
});

test("the unconfigured browser-download router leaves downloads untouched", async () => {
  await expect(
    BrowserDownloadRouting.route({ url: "https://example.test/file", filename: "file" }),
  ).resolves.toBeNull();
});

describe("browser download URL filter", () => {
  test("blank means every ordinary download", () => {
    expect(matchesBrowserDownloadFilter("https://example.com/file.zip", "")).toBe(true);
  });

  test("disabled filters retain their text without limiting downloads", () => {
    expect(
      matchesBrowserDownloadFilter(
        "https://other.example/file.zip",
        "*://allowed.example/*",
        "*://other.example/*",
        false,
      ),
    ).toBe(true);
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

  test("builds a routing state whose source URL supports the standard matchers", () => {
    const state = createBrowserDownloadState(item as any);
    expect(state.path).toBeInstanceOf(Path);
    expect(state.info).toMatchObject({
      url: item.url,
      sourceUrl: item.url,
      filename: "cat.jpg",
      suggestedFilename: "cat.jpg",
      initialFilename: "cat.jpg",
      context: "browser",
      currentTab: null,
    });
    expect(state.info.pageUrl).toBeUndefined();

    const rules = parseRules("fileext: jpg\ninto: matched/:filename:");
    expect(matchRules(rules, state.info)).toBe("matched/:filename:");
  });

  test("normalizes final URLs, metadata, and degenerate filenames", () => {
    const state = createBrowserDownloadState({
      url: "https://example.test/original",
      finalUrl: "https://cdn.example.test/final",
      filename: "\\",
      mime: "IMAGE/PNG; charset=binary",
      referrer: "https://example.test/page",
    });

    expect(state.info).toMatchObject({
      url: "https://cdn.example.test/final",
      sourceUrl: "https://cdn.example.test/final",
      filename: "\\",
      mime: "image/png",
      referrerUrl: "https://example.test/page",
    });
    expect(
      createBrowserDownloadState({
        url: "https://example.test/fallback-name",
        filename: "",
      }).info.filename,
    ).toBe("fallback-name");
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
      resolveRenameTransform: vi.fn(() => Promise.resolve()),
      finalizeFullPath: vi.fn(() => "browser/cat.jpg"),
    };
    await expect(routeBrowserDownload(download as any, item as any)).resolves.toBe(
      "browser/cat.jpg",
    );
    expect(download.finalizeFullPath).toHaveBeenCalledOnce();
  });

  test("ordinary rename-only routing honors a rename: rule end to end", async () => {
    // Representative pipeline case: unlike fetch:, a rename: rule stays
    // eligible for browser-owned downloads and edits the suggested name.
    const { getRoutingMatches, resolveRenameTransform } =
      await import("../../src/downloads/download-plan.ts");
    const { finalizeFullPath } = await import("../../src/downloads/download-disposition.ts");
    const { options } = await import("../../src/config/options-data.ts");
    const previous = {
      filenamePatterns: options.filenamePatterns,
      truncateLength: options.truncateLength,
      replacementChar: options.replacementChar,
    };
    Object.assign(options, {
      filenamePatterns: parseRules("fileext: jpg\nrename/g: cat -> dog\ninto: browser/:filename:"),
      truncateLength: 0,
      replacementChar: "_",
    });
    try {
      await expect(
        routeBrowserDownload(
          { getRoutingMatches, resolveRenameTransform, finalizeFullPath },
          {
            url: "https://cdn.example/files/cat.jpg",
            filename: "cat.jpg",
          },
        ),
      ).resolves.toBe("browser/dog.jpg");
    } finally {
      Object.assign(options, previous);
    }
  });
});
