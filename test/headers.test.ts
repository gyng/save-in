import { options } from "../src/config/options-data.ts";
import { BROWSERS, setCurrentBrowser } from "../src/platform/chrome-detector.ts";
import { RequestHeaders } from "../src/downloads/headers.ts";

beforeEach(() => {
  options.setRefererHeader = true;
  options.setRefererHeaderFilter = "*://i.pximg.net/*";
  setCurrentBrowser(BROWSERS.FIREFOX);
});

describe("matchesRefererFilter", () => {
  test("matches configured WebExtension patterns", () => {
    expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/img/foo.png")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("http://i.pximg.net/img.jpg")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://example.com/foo.png")).toBe(false);
  });

  test("does not match a target embedded in another URL", () => {
    expect(RequestHeaders.matchesRefererFilter("https://evil.com/?u=https://i.pximg.net/")).toBe(
      false,
    );
  });

  test("supports multiple patterns and wildcard paths", () => {
    options.setRefererHeaderFilter = "*://i.pximg.net/*\n*://example.org/downloads/*";
    expect(RequestHeaders.matchesRefererFilter("https://example.org/downloads/a")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://example.org/other/a")).toBe(false);
  });

  test("escapes regex punctuation", () => {
    options.setRefererHeaderFilter = "*://a.b/c?d=e*";
    expect(RequestHeaders.matchesRefererFilter("https://a.b/c?d=e&f=g")).toBe(true);
    expect(RequestHeaders.matchesRefererFilter("https://axb/cxd=e")).toBe(false);
  });

  test("rejects empty, malformed, and throwing patterns", () => {
    for (const pattern of ["", "\n  \n", "not-a-match-pattern"]) {
      options.setRefererHeaderFilter = pattern;
      expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    }
    const original = RequestHeaders.matchPatternToRegExp;
    RequestHeaders.matchPatternToRegExp = () => {
      throw new Error("bad pattern");
    };
    try {
      options.setRefererHeaderFilter = "*://i.pximg.net/*";
      expect(RequestHeaders.matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    } finally {
      RequestHeaders.matchPatternToRegExp = original;
    }
  });
});

describe("matchPatternToRegExp", () => {
  test("rejects unsupported schemes and malformed input", () => {
    expect(RequestHeaders.matchPatternToRegExp("not-a-match-pattern")).toBe(null);
    expect(RequestHeaders.matchPatternToRegExp("gopher://weird/*")).toBe(null);
  });

  test("supports literal, any-host, and subdomain hosts", () => {
    expect(
      RequestHeaders.matchPatternToRegExp("https://example.com/*")?.test("https://example.com/x"),
    ).toBe(true);
    expect(
      RequestHeaders.matchPatternToRegExp("*://*/download/*")?.test("http://a.test/download/x"),
    ).toBe(true);
    const subdomains = RequestHeaders.matchPatternToRegExp("*://*.example.com/*")!;
    expect(subdomains.test("https://example.com/x")).toBe(true);
    expect(subdomains.test("https://a.example.com/x")).toBe(true);
  });

  test("ignores explicit ports as WebExtension match patterns do", () => {
    expect(
      RequestHeaders.matchPatternToRegExp("*://127.0.0.1/*")?.test(
        "http://127.0.0.1:43123/file.png",
      ),
    ).toBe(true);
  });
});

describe("getDownloadHeaders", () => {
  const state = {
    info: {
      url: "https://i.pximg.net/img/foo.png",
      pageUrl: "https://www.pixiv.net/artworks/123",
    },
  };

  test("returns a per-download Referer header on Firefox", () => {
    expect(RequestHeaders.getDownloadHeaders(state)).toEqual([
      { name: "Referer", value: state.info.pageUrl },
    ]);
  });

  test("removes credentials and fragments from the disclosed Referer", () => {
    expect(
      RequestHeaders.getDownloadHeaders({
        info: {
          url: state.info.url,
          pageUrl: "https://user:secret@www.pixiv.net/artworks/123#private",
        },
      }),
    ).toEqual([{ name: "Referer", value: "https://www.pixiv.net/artworks/123" }]);
  });

  test("returns nothing on Chrome, which rejects Referer as unsafe", () => {
    setCurrentBrowser(BROWSERS.CHROME);
    expect(RequestHeaders.getDownloadHeaders(state)).toBeUndefined();
  });

  test("returns the sanitized Referer for Chrome's protected fetch", () => {
    setCurrentBrowser(BROWSERS.CHROME);
    expect(RequestHeaders.getFetchReferer(state)).toBe(state.info.pageUrl);
    expect(
      RequestHeaders.getFetchReferer({
        info: {
          url: state.info.url,
          pageUrl: "https://user:secret@www.pixiv.net/artworks/123#private",
        },
      }),
    ).toBe("https://www.pixiv.net/artworks/123");
  });

  test("returns nothing when disabled, incomplete, or unmatched", () => {
    options.setRefererHeader = false;
    expect(RequestHeaders.getDownloadHeaders(state)).toBeUndefined();
    options.setRefererHeader = true;
    expect(RequestHeaders.getDownloadHeaders({ info: { url: state.info.url } })).toBeUndefined();
    expect(
      RequestHeaders.getDownloadHeaders({
        info: { url: "https://example.com/a", pageUrl: state.info.pageUrl },
      }),
    ).toBeUndefined();
  });
});
