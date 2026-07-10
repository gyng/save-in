const Util = (await import("../src/util.js")).default;

describe("Util.withUrl", () => {
  test("calls the callback with the parsed URL", () => {
    expect(Util.withUrl("https://example.com/a?b=c", (u) => u.hostname)).toBe("example.com");
    expect(Util.withUrl("https://x/y", (u) => u.protocol)).toBe("https:");
  });

  test("returns the fallback on an unparseable URL", () => {
    expect(Util.withUrl("not a url", (u) => u.hostname, null)).toBe(null);
    expect(Util.withUrl("nope", (u) => u.protocol, false)).toBe(false);
    expect(Util.withUrl("nope", (u) => u.hostname, "keep")).toBe("keep");
  });

  test("fallback defaults to null", () => {
    expect(Util.withUrl("nope", (u) => u.hostname)).toBe(null);
  });
});

describe("Util.splitLines", () => {
  test("splits, trims, and drops empty/whitespace lines", () => {
    expect(Util.splitLines("a\n  b \n\n  \nc")).toEqual(["a", "b", "c"]);
    expect(Util.splitLines("*://i.pximg.net/*\n\n  \n")).toEqual(["*://i.pximg.net/*"]);
  });

  test("returns [] for empty or nullish input", () => {
    expect(Util.splitLines("")).toEqual([]);
    expect(Util.splitLines(null)).toEqual([]);
    expect(Util.splitLines(undefined)).toEqual([]);
  });
});
