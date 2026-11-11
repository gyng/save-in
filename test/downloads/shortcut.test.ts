import { SHORTCUT_TYPES, DOWNLOAD_TYPES } from "../../src/shared/constants.ts";
import * as shortcut from "../../src/downloads/shortcut.ts";
import * as Download from "../../src/downloads/download.ts";
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
    const launch = vi.spyOn(Download, "launchDownload").mockResolvedValue({
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
    const expected = 'window.location.href = "https://x/foo"';
    expect(makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, "https://x/foo")).toContain(expected);
  });

  test("escapes the URL so a hostile link cannot inject script", () => {
    const hostile = 'https://x/"</script><script>alert(1)</script>';
    const content = makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, hostile);
    // No literal </script> can appear to break out of the <script> element
    // (except the single legitimate one closing our own script tag)
    expect(content?.match(/<\/script>/g)).toHaveLength(1);
    expect(content).not.toContain("<script>alert(1)");
  });

  test("creates a Mac URL shortcut", () => {
    const expected = "[InternetShortcut]\nURL=https://x/foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.MAC, "https://x/foo")).toBe(expected);
  });

  test("creates a Windows URL shortcut", () => {
    const expected = "[InternetShortcut]\r\nURL=https://x/foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.WINDOWS, "https://x/foo")).toBe(expected);
  });

  test("creates a native macOS webloc without changing legacy MAC output", () => {
    const content = makeShortcutContent(SHORTCUT_TYPES.MAC_WEBLOC, "https://example.com/?a&b");
    expect(content).toContain("<key>URL</key>");
    expect(content).toContain("https://example.com/?a&amp;b");
    expect(makeShortcutContent(SHORTCUT_TYPES.MAC, "https://x/foo")).toBe(
      "[InternetShortcut]\nURL=https://x/foo",
    );
  });

  test("creates a Freedesktop URL shortcut without a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=https://x/foo\nTitle=https://x/foo\nURL=https://x/foo\n[InternetShortcut]\nURL=https://x/foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "https://x/foo")).toBe(expected);
  });

  test("creates a Freedesktop URL shortcut with a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=bar\nTitle=bar\nURL=https://x/foo\n[InternetShortcut]\nURL=https://x/foo";
    expect(makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "https://x/foo", "bar")).toBe(expected);
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

// A shortcut navigates to its address when the user opens the file, so a page
// that controls a link's href must not be able to put a script or a remote
// file share into one.
describe("shortcut address allowlist", () => {
  const types = [undefined, ...Object.values(SHORTCUT_TYPES)];

  test.each([
    "javascript:alert(document.domain)",
    " JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "file://attacker.example/share/x",
    "file:///etc/passwd",
    "\\\\attacker.example\\share\\x",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/0b1c",
    "vbscript:msgbox(1)",
    "ms-msdt:/id",
    "about:blank",
    "chrome://settings/",
    "relative/path",
    "",
  ])("refuses %j for every shortcut type", (address) => {
    const makeObjectUrl = vi.spyOn(Download, "makeObjectUrl");
    for (const type of types) {
      expect(makeShortcutContent(type, address)).toBeNull();
      expect(shortcut.makeShortcut(type, address, "Title")).toBeNull();
    }
    expect(makeObjectUrl).not.toHaveBeenCalled();
  });

  test.each(["http://example.com/a", "https://example.com/a?b#c", "ftp://example.com/file"])(
    "accepts %j for every shortcut type",
    (address) => {
      for (const type of types) expect(makeShortcutContent(type, address)).toContain(address);
    },
  );

  test("a local file is accepted only as the address of an open document", () => {
    const local = "file:///home/user/notes.html";

    expect(makeShortcutContent(SHORTCUT_TYPES.WINDOWS, local)).toBeNull();
    expect(
      makeShortcutContent(SHORTCUT_TYPES.WINDOWS, local, "", { browserDocument: false }),
    ).toBeNull();
    expect(
      makeShortcutContent(SHORTCUT_TYPES.WINDOWS, local, "", { browserDocument: true }),
    ).toContain(local);
    // Being the open document admits nothing else.
    expect(
      makeShortcutContent(SHORTCUT_TYPES.WINDOWS, "javascript:alert(1)", "", {
        browserDocument: true,
      }),
    ).toBeNull();
  });

  test("a source that cannot be linked gets no sidecar", async () => {
    options.saveSourceSidecar = true;
    options.shortcutType = SHORTCUT_TYPES.WINDOWS;
    const launch = vi.spyOn(Download, "launchDownload").mockClear();

    await launchSourceSidecar({ sourceUrl: "blob:https://example.com/0b1c" }, "gallery/a.png");
    await launchSourceSidecar({ sourceUrl: "data:image/png;base64,AAAA" }, "gallery/a.png");

    expect(launch).not.toHaveBeenCalled();
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
