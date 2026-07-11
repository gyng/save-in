import * as constants from "../src/constants.ts";

vi.mock("../src/download.ts", () => ({
  get Download() {
    return globalThis.Download;
  },
}));
vi.mock("../src/path.ts", () => ({
  get Path() {
    return globalThis.Path;
  },
}));
vi.mock("../src/current-tab.ts", () => ({
  get currentTab() {
    return globalThis.currentTab;
  },
  setCurrentTab: (t) => {
    globalThis.currentTab = t;
  },
}));

import { Shortcut as shortcut } from "../src/shortcut.ts";

// Needed by makeShortcut/suggestShortcutFilename below (DOWNLOAD_TYPES,
// SHORTCUT_EXTENSIONS); SHORTCUT_TYPES is also (re)assigned per-describe below.
Object.assign(global, constants);

describe("shortcut content creation", () => {
  let oldShortcutTypes;
  let SHORTCUT_TYPES;

  beforeAll(() => {
    oldShortcutTypes = window.SHORTCUT_TYPES;
    SHORTCUT_TYPES = constants.SHORTCUT_TYPES;
    window.SHORTCUT_TYPES = constants.SHORTCUT_TYPES;
  });

  afterAll(() => {
    window.SHORTCUT_TYPES = oldShortcutTypes;
  });

  test("creates a HTML redirect shortcut", () => {
    const expected = 'window.location.href = "foo"';
    expect(shortcut.makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, "foo")).toContain(expected);
  });

  test("escapes the URL so a hostile link cannot inject script", () => {
    const hostile = 'https://x/"</script><script>alert(1)</script>';
    const content = shortcut.makeShortcutContent(SHORTCUT_TYPES.HTML_REDIRECT, hostile);
    // No literal </script> can appear to break out of the <script> element
    // (except the single legitimate one closing our own script tag)
    expect(content.match(/<\/script>/g)).toHaveLength(1);
    expect(content).not.toContain("<script>alert(1)");
  });

  test("creates a Mac URL shortcut", () => {
    const expected = "[InternetShortcut]\nURL=foo";
    expect(shortcut.makeShortcutContent(SHORTCUT_TYPES.MAC, "foo")).toBe(expected);
  });

  test("creates a Windows URL shortcut", () => {
    const expected = "[InternetShortcut]\r\nURL=foo";
    expect(shortcut.makeShortcutContent(SHORTCUT_TYPES.WINDOWS, "foo")).toBe(expected);
  });

  test("creates a Freedesktop URL shortcut without a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=foo\nTitle=foo\nURL=foo\n[InternetShortcut]\nURL=foo";
    expect(shortcut.makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "foo")).toBe(expected);
  });

  test("creates a Freedesktop URL shortcut with a title", () => {
    const expected =
      "[Desktop Entry]\nEncoding=UTF-8\nIcon=text-html\nType=Link\nName=bar\nTitle=bar\nURL=foo\n[InternetShortcut]\nURL=foo";
    expect(shortcut.makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "foo", "bar")).toBe(expected);
  });

  test("falls back to the URL for an unknown/undefined shortcut type", () => {
    expect(shortcut.makeShortcutContent(undefined, "https://example.com")).toBe(
      "https://example.com",
    );
    expect(shortcut.makeShortcutContent("SOME_UNKNOWN_TYPE", "https://example.com")).toBe(
      "https://example.com",
    );
  });
});

describe("makeShortcut", () => {
  let originalCurrentTab;
  let originalDownload;

  beforeEach(() => {
    originalCurrentTab = global.currentTab;
    originalDownload = global.Download;
    global.Download = { makeObjectUrl: jest.fn((content) => `objurl:${content}`) };
  });

  afterEach(() => {
    global.currentTab = originalCurrentTab;
    global.Download = originalDownload;
  });

  test("uses the explicit title over currentTab when provided", () => {
    global.currentTab = { title: "Current Tab Title" };

    shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com", "Explicit Title");

    expect(global.Download.makeObjectUrl).toHaveBeenCalledWith(
      expect.stringContaining("Name=Explicit Title"),
      "application/octet-stream",
    );
  });

  test("defaults the title to currentTab.title when none is given", () => {
    global.currentTab = { title: "Current Tab Title" };

    shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com");

    expect(global.Download.makeObjectUrl).toHaveBeenCalledWith(
      expect.stringContaining("Name=Current Tab Title"),
      "application/octet-stream",
    );
  });

  test("falls back to the URL when there is no currentTab", () => {
    global.currentTab = undefined;

    const result = shortcut.makeShortcut(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com");

    expect(global.Download.makeObjectUrl).toHaveBeenCalledWith(
      expect.stringContaining("Name=https://example.com"),
      "application/octet-stream",
    );
    expect(result).toBe(
      "objurl:" + shortcut.makeShortcutContent(SHORTCUT_TYPES.FREEDESKTOP, "https://example.com"),
    );
  });
});

describe("suggestShortcutFilename", () => {
  let originalPath;
  let originalCurrentTab;

  beforeEach(() => {
    originalPath = global.Path;
    originalCurrentTab = global.currentTab;
    global.Path = { sanitizeFilename: jest.fn((name) => name) };
  });

  afterEach(() => {
    global.Path = originalPath;
    global.currentTab = originalCurrentTab;
  });

  describe("PAGE download type", () => {
    test("prefers the suggested filename", () => {
      global.currentTab = { title: "Tab Title" };
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
      global.currentTab = { title: "Tab Title" };
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
      global.currentTab = undefined;
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
      global.currentTab = undefined;
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
      global.currentTab = undefined;
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

  test("passes maxlen minus the extension length to Path.sanitizeFilename", () => {
    const info = { linkUrl: "link" };

    shortcut.suggestShortcutFilename(
      SHORTCUT_TYPES.MAC,
      DOWNLOAD_TYPES.MEDIA,
      info,
      undefined,
      100,
    );

    expect(global.Path.sanitizeFilename).toHaveBeenCalledWith("link", 100 - 4); // ".url" is 4 chars
  });
});

describe("shortcut mime types (#161)", () => {
  beforeEach(() => {
    global.SHORTCUT_TYPES = constants.SHORTCUT_TYPES;
    global.Download = { makeObjectUrl: jest.fn((content) => `objurl:${content}`) };
    global.currentTab = { title: "t" };
  });

  test("HTML redirects are served as text/html so browsers keep .html", () => {
    shortcut.makeShortcut(constants.SHORTCUT_TYPES.HTML_REDIRECT, "https://x/");
    expect(global.Download.makeObjectUrl).toHaveBeenCalledWith(expect.any(String), "text/html");
  });

  test(".url and .desktop shortcuts use octet-stream so browsers keep the extension", () => {
    for (const type of ["MAC", "WINDOWS", "FREEDESKTOP"]) {
      shortcut.makeShortcut(constants.SHORTCUT_TYPES[type], "https://x/");
      expect(global.Download.makeObjectUrl).toHaveBeenLastCalledWith(
        expect.any(String),
        "application/octet-stream",
      );
    }
  });
});
