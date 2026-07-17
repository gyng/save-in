import { matchesAnyPattern, parseMatchPatternList } from "../../src/shared/match-pattern.ts";
import { parsePatternList, parseRegularExpressionList } from "../../src/shared/pattern-list.ts";

describe("pattern list grammar", () => {
  test("locates trimmed entries and skips blank lines", () => {
    expect(parsePatternList("  first  \n\n\tsecond", (value) => value)).toEqual({
      entries: [
        { source: "first", value: "first", start: 2, end: 7, line: 1, column: 2 },
        { source: "second", value: "second", start: 12, end: 18, line: 3, column: 1 },
      ],
      issues: [],
    });
    expect(parsePatternList(null, (value) => value)).toEqual({ entries: [], issues: [] });
  });

  test("reports a parser error at its source line", () => {
    const result = parsePatternList("valid\n  broken ", (value) =>
      value === "broken" ? new Error("Nope") : value,
    );

    expect(result.entries).toEqual([
      { source: "valid", value: "valid", start: 0, end: 5, line: 1, column: 0 },
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        source: "broken",
        start: 8,
        end: 14,
        line: 2,
        column: 2,
        error: expect.objectContaining({ message: "Nope" }),
      }),
    ]);
  });

  test("parses WebExtension pattern components and keeps invalid lines separate", () => {
    const result = parseMatchPatternList(" *://*.example.com/files/* \nnot a pattern");

    expect(result.entries).toEqual([
      expect.objectContaining({
        source: "*://*.example.com/files/*",
        value: expect.objectContaining({
          scheme: "*",
          host: "*.example.com",
          path: "/files/*",
        }),
      }),
    ]);
    expect(result.issues).toEqual([expect.objectContaining({ line: 2, source: "not a pattern" })]);
  });

  test("requires hosts for network schemes but permits hostless file patterns", () => {
    const result = parseMatchPatternList("https:///files/*\nfile:///tmp/*");

    expect(result.entries).toEqual([
      expect.objectContaining({
        source: "file:///tmp/*",
        value: expect.objectContaining({ scheme: "file", host: "", path: "/tmp/*" }),
      }),
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ line: 1, source: "https:///files/*" }),
    ]);
  });

  test("compiles regular expressions atomically for callers", () => {
    const valid = parseRegularExpressionList("example\\.com\n/files/");
    expect(valid.issues).toEqual([]);
    expect(valid.entries.map(({ value }) => value.test("https://example.com/files/a"))).toEqual([
      true,
      true,
    ]);

    const invalid = parseRegularExpressionList("example\n(");
    expect(invalid.entries).toHaveLength(1);
    expect(invalid.issues[0]).toEqual(
      expect.objectContaining({ line: 2, source: "(", error: expect.any(Error) }),
    );
  });

  test("ignores the URL fragment when matching, per the match-pattern spec", () => {
    // A page URL carrying a #fragment must still match a disable-list entry;
    // WebExtension match patterns are specified to ignore the fragment.
    expect(matchesAnyPattern("https://example.com/gallery#photo-3", "*://example.com/*")).toBe(
      true,
    );
    expect(matchesAnyPattern("https://example.com/#/spa/route", "*://example.com/")).toBe(true);
    // The fragment must not smuggle a false match past a path-anchored pattern.
    expect(matchesAnyPattern("https://other.test/#https://example.com/", "*://example.com/*")).toBe(
      false,
    );
    expect(matchesAnyPattern("https://example.com/gallery", "")).toBe(false);
    // A value the URL parser rejects still gets its fragment stripped before
    // the textual fallback comparison (and never matches a real pattern).
    expect(matchesAnyPattern("not a url#fragment", "*://example.com/*")).toBe(false);
    expect(matchesAnyPattern("not a url", "*://example.com/*")).toBe(false);
  });

  test("matches hosts case-insensitively but keeps the path case-sensitive", () => {
    // Hosts are case-insensitive per the spec: a user's uppercase host in a
    // disable/exclude pattern must still match the browser's lowercased URL.
    expect(matchesAnyPattern("https://example.com/x", "*://Example.com/*")).toBe(true);
    expect(matchesAnyPattern("https://example.com/x", "*://*.Example.COM/*")).toBe(true);
    // Paths stay case-sensitive.
    expect(matchesAnyPattern("https://example.com/Private", "*://example.com/private")).toBe(false);
  });

  test("matches an internationalised host written the way the address bar shows it", () => {
    // The URL parser canonicalises a host to punycode, so a pattern compiled
    // from the raw unicode the user typed could never meet it: the disable-list
    // entry silently never fired and the content script kept running on a site
    // the user had opted out of.
    expect(matchesAnyPattern("https://例え.jp/a", "*://例え.jp/*")).toBe(true);
    expect(matchesAnyPattern("https://xn--r8jz45g.jp/a", "*://例え.jp/*")).toBe(true);
    expect(matchesAnyPattern("https://sub.例え.jp/a", "*://*.例え.jp/*")).toBe(true);
    // Punycode written directly keeps working, from either side.
    expect(matchesAnyPattern("https://例え.jp/a", "*://xn--r8jz45g.jp/*")).toBe(true);
    // A different IDN host must still not match.
    expect(matchesAnyPattern("https://別.jp/a", "*://例え.jp/*")).toBe(false);
    // A host the URL parser rejects — "xn--a" is not decodable punycode — must
    // not throw out of the matcher and into isCurrentPageDisabled. It stays as
    // written and compares textually, exactly as it did before.
    expect(() => matchesAnyPattern("https://xn--a.com/a", "*://xn--a.com/*")).not.toThrow();
    expect(matchesAnyPattern("https://xn--a.com/a", "*://xn--a.com/*")).toBe(true);
  });

  test("rejects host wildcards the spec does not allow", () => {
    // `*` is legal in a host only as the entire host or as a leading `*.`
    // label. Escaped nowhere and quantifying the character before it, an
    // embedded `*` compiles `foo*.example.com` to /foo*\.example\.com/, which
    // matches fo.example.com — a host the user never wrote — while missing
    // every host they meant. Both browsers reject these outright.
    expect(matchesAnyPattern("https://fo.example.com/x", "*://foo*.example.com/*")).toBe(false);
    expect(matchesAnyPattern("https://foo.example.com/x", "*://foo*.example.com/*")).toBe(false);
    expect(matchesAnyPattern("https://secur.bank.com/x", "*://secure*.bank.com/*")).toBe(false);
    expect(matchesAnyPattern("https://a.foo.com/x", "*://*.foo*.com/*")).toBe(false);

    // The editor learns about it, rather than the entry being silently dropped.
    const result = parseMatchPatternList("*://foo*.example.com/*");
    expect(result.entries).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({ line: 1, source: "*://foo*.example.com/*" }),
    ]);

    // The two legal wildcard forms are unaffected.
    expect(matchesAnyPattern("https://a.example.com/x", "*://*.example.com/*")).toBe(true);
    expect(matchesAnyPattern("https://example.com/x", "*://*/*")).toBe(true);
  });

  test("ignores userinfo so credentials cannot shift the apparent host", () => {
    // The parser resolves the host to evil.com regardless of "user@"; a textual
    // match on the raw string would have missed the disable/exclude entry.
    expect(matchesAnyPattern("https://user@evil.com/x", "*://evil.com/*")).toBe(true);
    expect(matchesAnyPattern("https://user:pw@evil.com/x", "*://evil.com/*")).toBe(true);
    // Credentials naming a different host do not make an unrelated pattern match.
    expect(matchesAnyPattern("https://good.example@evil.com/x", "*://good.example/*")).toBe(false);

    // The same invariant on the pattern side: canonicalising the host must not
    // resolve an entry's own credentials, or an entry that reads i.pximg.net
    // silently scopes to evil.com. These matched nothing before the host was
    // canonicalised, and must not start now — for setRefererHeaderFilter the
    // wrong direction sends the page URL to a host the allowlist never named.
    expect(matchesAnyPattern("https://evil.com/x", "*://i.pximg.net@evil.com/*")).toBe(false);
    expect(matchesAnyPattern("https://example.com/x", "*://user@example.com/*")).toBe(false);
    // A port is not part of the pattern grammar either; dropping a default one
    // silently widens the entry to every port the host answers on.
    expect(matchesAnyPattern("http://example.com/x", "http://example.com:443/*")).toBe(false);
  });

  test("falls back to the raw string when the URL does not parse", () => {
    // A non-URL value still tests textually (fragment-stripped) as before, so
    // no previously matching input silently stops matching.
    expect(matchesAnyPattern("not a url", "*://example.com/*")).toBe(false);
  });

  test("normalizes non-Error regular expression failures", () => {
    const NativeRegExp = globalThis.RegExp;
    class ThrowingRegExp extends NativeRegExp {
      constructor(pattern: string | RegExp = "", flags?: string) {
        if (pattern === "throw-non-error") throw "constructor rejected the pattern";
        super(pattern, flags);
      }
    }
    vi.stubGlobal("RegExp", ThrowingRegExp);
    const result = (() => {
      try {
        return parseRegularExpressionList("throw-non-error");
      } finally {
        vi.unstubAllGlobals();
      }
    })();

    expect(result.entries).toEqual([]);
    expect(result.issues[0]?.error).toEqual(
      expect.objectContaining({ message: "constructor rejected the pattern" }),
    );
  });
});
