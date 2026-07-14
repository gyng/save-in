import { parseMatchPatternList } from "../src/shared/match-pattern.ts";
import { parsePatternList, parseRegularExpressionList } from "../src/shared/pattern-list.ts";

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
