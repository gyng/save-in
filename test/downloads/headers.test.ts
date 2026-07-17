import { options } from "../../src/config/options-data.ts";
import { BROWSERS, setCurrentBrowser } from "../../src/platform/chrome-detector.ts";
import {
  matchesRefererFilter,
  getDownloadHeaders,
  getFetchReferer,
} from "../../src/downloads/headers.ts";
import * as MatchPattern from "../../src/shared/match-pattern.ts";

const { matchPatternToRegExp } = MatchPattern;

beforeEach(() => {
  options.setRefererHeader = true;
  options.setRefererHeaderFilter = "*://i.pximg.net/*";
  setCurrentBrowser(BROWSERS.FIREFOX);
});

describe("matchesRefererFilter", () => {
  test("matches configured WebExtension patterns", () => {
    expect(matchesRefererFilter("https://i.pximg.net/img/foo.png")).toBe(true);
    expect(matchesRefererFilter("http://i.pximg.net/img.jpg")).toBe(true);
    expect(matchesRefererFilter("https://example.com/foo.png")).toBe(false);
  });

  test("does not match a target embedded in another URL", () => {
    expect(matchesRefererFilter("https://evil.com/?u=https://i.pximg.net/")).toBe(false);
  });

  // The filter and the per-site disable list are the same pattern syntax, so an
  // entry a user writes once must mean the same thing in both. The filter read
  // the raw URL rather than the canonical one, so a host the URL parser
  // rewrites — userinfo, uppercase, punycode — silently failed the allowlist
  // and the download went out with no Referer.
  test("canonicalizes the URL the way the disable list does", () => {
    expect(matchesRefererFilter("https://user@i.pximg.net/img.jpg")).toBe(true);
    expect(matchesRefererFilter("https://I.PXimg.NET/img.jpg")).toBe(true);

    options.setRefererHeaderFilter = "*://例え.jp/*";
    expect(matchesRefererFilter("https://例え.jp/img.jpg")).toBe(true);

    // The fragment is ignored per the spec, so it cannot defeat an exact path.
    options.setRefererHeaderFilter = "*://i.pximg.net/img.jpg";
    expect(matchesRefererFilter("https://i.pximg.net/img.jpg#frag")).toBe(true);

    // Canonicalizing must not widen the allowlist: a lookalike host that only
    // appears in the userinfo still sends nothing.
    options.setRefererHeaderFilter = "*://i.pximg.net/*";
    expect(matchesRefererFilter("https://i.pximg.net@evil.com/img.jpg")).toBe(false);
  });

  test("supports multiple patterns and wildcard paths", () => {
    options.setRefererHeaderFilter = "*://i.pximg.net/*\n*://example.org/downloads/*";
    expect(matchesRefererFilter("https://example.org/downloads/a")).toBe(true);
    expect(matchesRefererFilter("https://example.org/other/a")).toBe(false);
  });

  test("escapes regex punctuation", () => {
    options.setRefererHeaderFilter = "*://a.b/c?d=e*";
    expect(matchesRefererFilter("https://a.b/c?d=e&f=g")).toBe(true);
    expect(matchesRefererFilter("https://axb/cxd=e")).toBe(false);
  });

  // An allowlist that parses to nothing allows nothing: a malformed entry must
  // never widen the filter into sending the header everywhere.
  test("rejects empty and malformed patterns", () => {
    for (const pattern of ["", "\n  \n", "not-a-match-pattern", "*://foo*.bar.com/*"]) {
      options.setRefererHeaderFilter = pattern;
      expect(matchesRefererFilter("https://i.pximg.net/a.png")).toBe(false);
    }
  });
});

describe("matchPatternToRegExp", () => {
  test("rejects unsupported schemes and malformed input", () => {
    expect(matchPatternToRegExp("not-a-match-pattern")).toBe(null);
    expect(matchPatternToRegExp("gopher://weird/*")).toBe(null);
  });

  test("supports literal, any-host, and subdomain hosts", () => {
    expect(matchPatternToRegExp("https://example.com/*")?.test("https://example.com/x")).toBe(true);
    expect(matchPatternToRegExp("*://*/download/*")?.test("http://a.test/download/x")).toBe(true);
    const subdomains = matchPatternToRegExp("*://*.example.com/*")!;
    expect(subdomains.test("https://example.com/x")).toBe(true);
    expect(subdomains.test("https://a.example.com/x")).toBe(true);
    expect(matchPatternToRegExp("file:///*")?.test("file:///tmp/image.png")).toBe(true);
  });

  test("ignores explicit ports as WebExtension match patterns do", () => {
    expect(matchPatternToRegExp("*://127.0.0.1/*")?.test("http://127.0.0.1:43123/file.png")).toBe(
      true,
    );
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
    expect(getDownloadHeaders(state)).toEqual([{ name: "Referer", value: state.info.pageUrl }]);
  });

  test("removes credentials and fragments from the disclosed Referer", () => {
    expect(
      getDownloadHeaders({
        info: {
          url: state.info.url,
          pageUrl: "https://user:secret@www.pixiv.net/artworks/123#private",
        },
      }),
    ).toEqual([{ name: "Referer", value: "https://www.pixiv.net/artworks/123" }]);
  });

  test("returns nothing on Chrome, which rejects Referer as unsafe", () => {
    setCurrentBrowser(BROWSERS.CHROME);
    expect(getDownloadHeaders(state)).toBeUndefined();
  });

  test("returns the sanitized Referer for Chrome's protected fetch", () => {
    setCurrentBrowser(BROWSERS.CHROME);
    expect(getFetchReferer(state)).toBe(state.info.pageUrl);
    expect(
      getFetchReferer({
        info: {
          url: state.info.url,
          pageUrl: "https://user:secret@www.pixiv.net/artworks/123#private",
        },
      }),
    ).toBe("https://www.pixiv.net/artworks/123");
  });

  test("returns the Referer for Firefox protected metadata and content fetches", () => {
    expect(getFetchReferer(state)).toBe(state.info.pageUrl);
  });

  test("returns nothing when disabled, incomplete, or unmatched", () => {
    options.setRefererHeader = false;
    expect(getDownloadHeaders(state)).toBeUndefined();
    options.setRefererHeader = true;
    expect(getDownloadHeaders({ info: { url: state.info.url } })).toBeUndefined();
    expect(
      getDownloadHeaders({
        info: { url: "https://example.com/a", pageUrl: state.info.pageUrl },
      }),
    ).toBeUndefined();
    expect(
      getDownloadHeaders({
        info: { url: state.info.url, pageUrl: "ftp://example.com/private" },
      }),
    ).toBeUndefined();
    expect(
      getDownloadHeaders({
        info: { url: state.info.url, pageUrl: "not a URL" },
      }),
    ).toBeUndefined();
  });
});
