import { Path } from "../../src/routing/path.ts";
import { matchRules, parseRules } from "../../src/routing/router.ts";
import { applyVariables } from "../../src/routing/variable.ts";
import { options as liveOptions } from "../../src/config/options-data.ts";
import { webExtensionApi } from "../../src/platform/web-extension-api.ts";
import {
  BROWSER_DOWNLOAD_PAGE_TIMEOUT_MS,
  BrowserDownloadRouting,
  createBrowserDownloadState,
  findBrowserDownloadPage,
  inferBrowserDownloadPage,
  isOrdinaryBrowserDownload,
  isReroutableBrowserDownload,
  matchesBrowserDownloadFilter,
  routeBrowserDownload,
} from "../../src/downloads/browser-downloads.ts";
import { browserTab } from "../support/webextension-host.fixture.ts";

describe("browser download page inference", () => {
  const page = "https://gallery.example/albums/cats?page=2";
  const tab = (url: string | undefined, overrides: { title?: string; incognito?: boolean } = {}) =>
    ({ url, title: "Cats", incognito: false, ...overrides }) as const;

  test.each([
    ["the one tab showing the referrer", page, [tab(page)], { url: page, title: "Cats" }],
    [
      "a tab whose address adds only a fragment",
      page,
      [tab(`${page}#photo-3`)],
      { url: `${page}#photo-3`, title: "Cats" },
    ],
    ["an untitled tab", page, [{ url: page, incognito: false }], { url: page, title: "" }],
    ["no referrer", undefined, [tab(page)], null],
    ["an unparseable referrer", "not a url", [tab("not a url")], null],
    ["a non-HTTP referrer", "file:///home/me/page.html", [tab("file:///home/me/page.html")], null],
    [
      "an origin-only referrer a policy may have shortened",
      "https://gallery.example/",
      [tab("https://gallery.example/")],
      null,
    ],
    ["no tab at the referrer", page, [tab("https://gallery.example/other"), tab(undefined)], null],
    ["two tabs at the referrer", page, [tab(page), tab(page, { title: "Cats again" })], null],
    ["a private tab at the referrer", page, [tab(page, { incognito: true })], null],
    ["a public and a private tab", page, [tab(page), tab(page, { incognito: true })], null],
    ["a tab whose privacy is unknown", page, [{ url: page, title: "Cats" }], null],
  ])("%s", (_name, referrer, tabs, expected) => {
    expect(inferBrowserDownloadPage(referrer, tabs)).toEqual(expected);
  });

  test("queries tabs only for a public download with a referrer", async () => {
    const queryTabs = vi.fn(async () => [tab(page)]);
    await expect(findBrowserDownloadPage({ referrer: page }, queryTabs)).resolves.toEqual({
      url: page,
      title: "Cats",
    });
    await expect(
      findBrowserDownloadPage({ referrer: page, incognito: true }, queryTabs),
    ).resolves.toBeNull();
    await expect(findBrowserDownloadPage({ incognito: false }, queryTabs)).resolves.toBeNull();
    expect(queryTabs).toHaveBeenCalledOnce();
  });

  test("a failed tab query yields no page", async () => {
    await expect(
      findBrowserDownloadPage({ referrer: page }, () => Promise.reject(new Error("no tabs"))),
    ).resolves.toBeNull();
  });

  test("a tab query that never settles yields no page after the bound", async () => {
    vi.useFakeTimers();
    try {
      const found = findBrowserDownloadPage({ referrer: page }, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(BROWSER_DOWNLOAD_PAGE_TIMEOUT_MS);
      await expect(found).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("an inferred page reaches the page matchers and variables", async () => {
    const state = createBrowserDownloadState(
      { url: "https://cdn.example/cat.jpg", filename: "cat.jpg", referrer: page },
      { url: page, title: "Cats album" },
    );
    expect(state.info).toMatchObject({
      pageUrl: page,
      currentTab: { title: "Cats album", url: page, incognito: false },
      referrerUrl: page,
    });
    expect(state.info.currentTab).not.toHaveProperty("id");
    const rules = parseRules(
      "pagetitle: ^Cats\npagedomain: ^gallery\\.example$\ninto: :pagedomain:/:pagetitle:/:filename:",
    );
    const route = matchRules(rules, state.info);
    expect(route).toBe(":pagedomain:/:pagetitle:/:filename:");
    expect((await applyVariables(new Path(route as string), state.info)).toString()).toBe(
      "gallery.example/Cats album/cat.jpg",
    );
  });
});

describe("browser download routing with page details", () => {
  const referrer = "https://gallery.example/albums/cats";
  const item = { url: "https://cdn.example/cat.jpg", filename: "cat.jpg", referrer };
  const download = () => ({
    getRoutingMatches: vi.fn((state: { info: { currentTab?: { title?: string } | null } }) =>
      state.info.currentTab?.title === "Cats" ? "cats/:filename:" : null,
    ),
    resolveRenameTransform: vi.fn(() => Promise.resolve()),
    finalizeFullPath: vi.fn(() => "cats/cat.jpg"),
  });

  afterEach(() => {
    liveOptions.browserDownloadPageDetails = false;
  });

  test("stays off by default so page rules keep missing browser downloads", async () => {
    expect(liveOptions.browserDownloadPageDetails).toBe(false);
    const query = vi.spyOn(webExtensionApi.tabs, "query");
    await expect(routeBrowserDownload(download() as any, item)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test("routes on the inferred page once enabled", async () => {
    liveOptions.browserDownloadPageDetails = true;
    const query = vi
      .spyOn(webExtensionApi.tabs, "query")
      .mockResolvedValue([browserTab({ url: referrer, title: "Cats" })]);
    await expect(routeBrowserDownload(download() as any, item)).resolves.toBe("cats/cat.jpg");
    expect(query).toHaveBeenCalledWith({});
  });
});

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

  test("a nonblank invalid exclude filter excludes everything", () => {
    // Forgetting the scheme is the ordinary mistake, and matchesAnyPattern
    // reports a rejected pattern as "no match" — which would leave the download
    // tracked and routed, the one outcome the line was written to prevent.
    expect(
      matchesBrowserDownloadFilter(
        "https://private.example.com/a.zip",
        "",
        "private.example.com/*",
      ),
    ).toBe(false);
    // One unreadable line must not quietly narrow the rest of the list either.
    expect(
      matchesBrowserDownloadFilter(
        "https://public.example.com/a.zip",
        "",
        "*://private.example.com/*\nnot a pattern",
      ),
    ).toBe(false);
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

  test("releases content a future ordinary-routing variable may prepare", async () => {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const download = {
      getRoutingMatches: vi.fn((state) => {
        state.info.contentPromise = Promise.resolve({
          blob: new Blob(["content"]),
          ownedObjectUrl: "blob:ordinary-routing",
        });
        return "browser/:filename:";
      }),
      resolveRenameTransform: vi.fn(() => Promise.resolve()),
      finalizeFullPath: vi.fn(() => "browser/cat.jpg"),
    };

    await expect(routeBrowserDownload(download as any, item as any)).resolves.toBe(
      "browser/cat.jpg",
    );

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ordinary-routing");
  });

  test("ordinary routing skips hash-dependent rules without fetching content", async () => {
    const { getRoutingMatches, resolveRenameTransform } =
      await import("../../src/downloads/download-plan.ts");
    const { finalizeFullPath } = await import("../../src/downloads/download-disposition.ts");
    const { options } = await import("../../src/config/options-data.ts");
    const previous = {
      filenamePatterns: options.filenamePatterns,
      truncateLength: options.truncateLength,
      replacementChar: options.replacementChar,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    Object.assign(options, {
      filenamePatterns: parseRules(
        "fileext: jpg\ninto: hashes/:sha256:/:filename:\n\n" +
          "fileext: jpg\nrename: cat -> :sha256full:\ninto: renamed/:filename:\n\n" +
          "fileext: jpg\ninto: browser/:filename:",
      ),
      truncateLength: 0,
      replacementChar: "_",
    });
    try {
      await expect(
        routeBrowserDownload(
          { getRoutingMatches, resolveRenameTransform, finalizeFullPath },
          { url: item.url, filename: item.filename },
        ),
      ).resolves.toBe("browser/cat.jpg");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      Object.assign(options, previous);
    }
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
