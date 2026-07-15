import { SHORTCUT_TYPES, DOWNLOAD_TYPES } from "../../src/shared/constants.ts";
import { Shortcut as shortcut } from "../../src/downloads/shortcut.ts";
import { Download } from "../../src/downloads/download.ts";
import * as Path from "../../src/routing/path.ts";
import { setCurrentTab } from "../../src/platform/current-tab.ts";
import {
  createSourceSidecarRequest,
  launchSourceSidecar,
  resolveSourceSidecarPrimaryPath,
} from "../../src/downloads/source-sidecar.ts";
import { options } from "../../src/config/options-data.ts";

const makeShortcutContent = shortcut.makeShortcutContent;

describe("shortcut content creation", () => {
  test("does not launch a source sidecar when the option is disabled", async () => {
    options.saveSourceSidecar = false;

    await expect(
      launchSourceSidecar({ sourceUrl: "https://example.com/source" }, "gallery/source.png"),
    ).resolves.toBeUndefined();
    expect(
      createSourceSidecarRequest(
        { info: {}, scratch: {}, path: { finalize: () => ".", toString: () => "." } },
        "https://example.com/source",
      ),
    ).toEqual({ sourceUrl: "https://example.com/source" });
  });

  test("keeps the routed folder while adopting the browser-resolved filename", async () => {
    expect(
      resolveSourceSidecarPrimaryPath(
        "gallery/source-name.png",
        "C:\\Downloads\\gallery\\server-name (1).jpg",
      ),
    ).toBe("gallery/server-name (1).jpg");
    expect(resolveSourceSidecarPrimaryPath("source-name.png", "/Downloads/final.png")).toBe(
      "final.png",
    );
    expect(resolveSourceSidecarPrimaryPath("gallery/source-name.png")).toBe(
      "gallery/source-name.png",
    );
    expect(resolveSourceSidecarPrimaryPath("gallery/source-name.png", "/")).toBe(
      "gallery/source-name.png",
    );

    options.saveSourceSidecar = true;
    options.shortcutType = SHORTCUT_TYPES.WINDOWS;
    options.truncateLength = 200;
    const launch = vi.spyOn(Download, "launch").mockResolvedValue({
      status: "started",
      downloadId: 8,
    });

    await launchSourceSidecar(
      {
        sourceUrl: "https://example.com/source.png",
        pageUrl: "https://example.com/gallery/",
        title: "Gallery",
      },
      "gallery/source-name.png",
      "C:\\Downloads\\gallery\\server-name (1).jpg",
    );

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.objectContaining({ raw: "gallery" }),
        info: expect.objectContaining({
          context: DOWNLOAD_TYPES.SIDECAR,
          menuItemTitle: "Source link",
          sourceUrl: "https://example.com/source.png",
          suggestedFilename: "server-name (1).url",
          suppressPrompt: true,
        }),
      }),
    );
  });

  test("names a source sidecar after the final routed file", () => {
    expect(
      shortcut.sourceSidecarPath("gallery/cat.large.jpg", SHORTCUT_TYPES.WINDOWS, 200),
    ).toEqual({ directory: "gallery", filename: "cat.large.url" });
    expect(shortcut.sourceSidecarPath("README", SHORTCUT_TYPES.MAC_WEBLOC, 200)).toEqual({
      directory: ".",
      filename: "README.webloc",
    });
    expect(shortcut.sourceSidecarPath("/", "UNKNOWN", 200)).toEqual({
      directory: ".",
      filename: "source.url",
    });
  });

  test("creates a HTML redirect shortcut", () => {
    const expected = 'window.location.href = "foo"';
    expect(makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, "foo")).toContain(expected);
  });

  test("escapes the URL so a hostile link cannot inject script", () => {
    const hostile = 'https://x/"</script><script>alert(1)</script>';
    const content = makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, hostile);
    // No literal </script> can appear to break out of the <script> element
    // (except the single legitimate one closing our own script tag)
    expect(content.match(/<\/script>/g)).toHaveLength(1);
    expect(content).not.toContain("<script>alert(1)");
  });

  test("creates a Mac URL shortcut", () => {
    const expected = "[InternetShortcut]\nURL=foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.MAC, "foo")).toBe(expected);
  });

  test("creates a Windows URL shortcut", () => {
    const expected = "[InternetShortcut]\r\nURL=foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.WINDOWS, "foo")).toBe(expected);
  });

  test("creates a native macOS webloc without changing legacy MAC output", () => {
    const content = makeShortcutContent(SHORTCUT_TYPES.MAC_WEBLOC, "https://example.com/?a&b");
    expect(content).toContain("<key>URL</key>");
    expect(content).toContain("https://example.com/?a&amp;b");
    expect(makeShortcutContent(SHORTCUT_TYPES.MAC, "foo")).toBe("[InternetShortcut]\nURL=foo");
  });

  test("creates a Freedesktop URL shortcut without a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=foo\nTitle=foo\nURL=foo\n[InternetShortcut]\nURL=foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "foo")).toBe(expected);
  });

  test("creates a Freedesktop URL shortcut with a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=bar\nTitle=bar\nURL=foo\n[InternetShortcut]\nURL=foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "foo", "bar")).toBe(expected);
  });

  test("escapes control characters in Freedesktop shortcut fields", () => {
    const content = makeShortcutContent(
      SHORTCUT_TYPES.FREEDESKTOP,
      "https://example.com/\nExec=bad",
      "Title\nExec=bad",
    );
    expect(content).not.toContain("\nExec=bad");
    expect(content).toContain("Name=Title\\nExec=bad");
  });

  test("falls back to the URL for an unknown/undefined shortcut type", () => {
    expect(makeShortcutContent(undefined, "https://example.com")).toBe("https://example.com");
    expect(makeShortcutContent("SOME_UNKNOWN_TYPE", "https://example.com")).toBe(
      "https://example.com",
    );
  });
});

describe("makeShortcut", () => {
  beforeEach(() => {
    vi.spyOn(Download, "makeObjectUrl").mockImplementation((content) => `objurl:${content}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCurrentTab(null);
  });

  test("uses the explicit title over currentTab when provided", () => {
    setCurrentTab({ title: "Current Tab Title" });

    shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com", "Explicit Title");

    expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenCalledWith(
      expect.stringContaining("Name=Explicit Title"),
      "application/octet-stream",
    );
  });

  test("defaults the title to currentTab.title when none is given", () => {
    setCurrentTab({ title: "Current Tab Title" });

    shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com");

    expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenCalledWith(
      expect.stringContaining("Name=Current Tab Title"),
      "application/octet-stream",
    );
  });

  test("falls back to the URL when there is no currentTab", () => {
    setCurrentTab(null);

    const result = shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com");

    expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenCalledWith(
      expect.stringContaining("Name=https://example.com"),
      "application/octet-stream",
    );
    expect(result).toBe(
      "objurl:" + makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com"),
    );
  });
});

describe("suggestShortcutFilename", () => {
  beforeEach(() => {
    vi.spyOn(Path, "sanitizeFilename").mockImplementation((name) => name);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCurrentTab(null);
  });

  describe("PAGE download type", () => {
    test("prefers the suggested filename", () => {
      setCurrentTab({ title: "Tab Title" });
      const info = { srcUrl: "src", linkUrl: "link", pageUrl: "page" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.MAC,
        DOWNLOAD_TYPES.PAGE,
        info,
        "suggested",
        100,
      );

      expect(result).toBe("suggested.url");
    });

    test("falls back to currentTab.title", () => {
      setCurrentTab({ title: "Tab Title" });
      const info = { srcUrl: "src", linkUrl: "link", pageUrl: "page" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.MAC,
        DOWNLOAD_TYPES.PAGE,
        info,
        undefined,
        100,
      );

      expect(result).toBe("Tab Title.url");
    });

    test("falls back to info.srcUrl", () => {
      setCurrentTab(null);
      const info = { srcUrl: "src", linkUrl: "link", pageUrl: "page" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.MAC,
        DOWNLOAD_TYPES.PAGE,
        info,
        undefined,
        100,
      );

      expect(result).toBe("src.url");
    });

    test("falls back to info.linkUrl", () => {
      setCurrentTab(null);
      const info = { linkUrl: "link", pageUrl: "page" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.MAC,
        DOWNLOAD_TYPES.PAGE,
        info,
        undefined,
        100,
      );

      expect(result).toBe("link.url");
    });

    test("falls back to info.pageUrl", () => {
      setCurrentTab(null);
      const info = { pageUrl: "page" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.MAC,
        DOWNLOAD_TYPES.PAGE,
        info,
        undefined,
        100,
      );

      expect(result).toBe("page.url");
    });
  });

  describe("non-PAGE download types", () => {
    test("prefers the suggested filename", () => {
      const info = { linkText: "text", srcUrl: "src", linkUrl: "link" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.MEDIA,
        info,
        "suggested",
        100,
      );

      expect(result).toBe("suggested.url");
    });

    test("falls back to info.linkText", () => {
      const info = { linkText: "text", srcUrl: "src", linkUrl: "link" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.MEDIA,
        info,
        undefined,
        100,
      );

      expect(result).toBe("text.url");
    });

    test("falls back to info.srcUrl", () => {
      const info = { srcUrl: "src", linkUrl: "link" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.MEDIA,
        info,
        undefined,
        100,
      );

      expect(result).toBe("src.url");
    });

    test("falls back to info.linkUrl", () => {
      const info = { linkUrl: "link" };

      const result = shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.MEDIA,
        info,
        undefined,
        100,
      );

      expect(result).toBe("link.url");
    });
  });

  test("uses an empty extension for shortcut types without one", () => {
    const info = { linkUrl: "link" };

    const result = shortcut.suggestShortcutFilename(
      "UNKNOWN_TYPE",
      DOWNLOAD_TYPES.MEDIA,
      info,
      undefined,
      100,
    );

    expect(result).toBe("link");
  });

  test("uses a stable fallback instead of an undefined filename", () => {
    expect(
      shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.MEDIA,
        {},
        undefined,
        100,
      ),
    ).toBe("shortcut.url");
    expect(
      shortcut.suggestShortcutFilename(
        SHORTCUT_TYPES.WINDOWS,
        DOWNLOAD_TYPES.PAGE,
        {},
        undefined,
        100,
      ),
    ).toBe("shortcut.url");
  });

  test("sanitizes the completed filename while preserving its extension", () => {
    const info = { linkUrl: "link" };

    shortcut.suggestShortcutFilename(
      SHORTCUT_TYPES.MAC,
      DOWNLOAD_TYPES.MEDIA,
      info,
      undefined,
      100,
    );

    expect(vi.mocked(Path.sanitizeFilename)).toHaveBeenCalledWith("link.url", 100, true, true);
  });
});

describe("shortcut mime types (#161)", () => {
  beforeEach(() => {
    vi.spyOn(Download, "makeObjectUrl").mockImplementation((content) => `objurl:${content}`);
    setCurrentTab({ title: "t" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setCurrentTab(null);
  });

  test("HTML redirects are served as text/html so browsers keep .html", () => {
    shortcut.makeShortcut(SHORTCUT_TYPES.HTML_REDIRECT, "https://x/");
    expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenCalledWith(expect.any(String), "text/html");
  });

  test("unknown shortcut types use plain text", () => {
    shortcut.makeShortcut(undefined, "https://x/");
    expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenCalledWith("https://x/", "text/plain");
  });

  test(".url and .desktop shortcuts use octet-stream so browsers keep the extension", () => {
    for (const type of ["MAC", "WINDOWS", "FREEDESKTOP"] as const) {
      shortcut.makeShortcut(SHORTCUT_TYPES[type], "https://x/");
      expect(vi.mocked(Download.makeObjectUrl)).toHaveBeenLastCalledWith(
        expect.any(String),
        "application/octet-stream",
      );
    }
  });
});
