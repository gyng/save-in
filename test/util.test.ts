import { splitLines, withUrl } from "../src/util.ts";

describe("withUrl", () => {
  test("calls the callback with the parsed URL", () => {
    expect(withUrl("https://example.com/a?b=c", (url) => url.hostname)).toBe("example.com");
    expect(withUrl("https://x/y", (url) => url.protocol)).toBe("https:");
  });

  test("returns the fallback on an unparseable URL", () => {
    expect(withUrl("not a url", (url) => url.hostname, null)).toBe(null);
    expect(withUrl("nope", (url) => url.protocol, false)).toBe(false);
    expect(withUrl("nope", (url) => url.hostname, "keep")).toBe("keep");
  });

  test("fallback defaults to null", () => {
    expect(withUrl("nope", (url) => url.hostname)).toBe(null);
  });
});

describe("splitLines", () => {
  test("splits, trims, and drops empty/whitespace lines", () => {
    expect(splitLines("a\n  b \n\n  \nc")).toEqual(["a", "b", "c"]);
    expect(splitLines("*://i.pximg.net/*\n\n  \n")).toEqual(["*://i.pximg.net/*"]);
  });

  test("returns [] for empty or nullish input", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines(null)).toEqual([]);
    expect(splitLines(undefined)).toEqual([]);
  });
});
