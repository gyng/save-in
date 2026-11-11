import {
  isPageTextCapture,
  isPageTextSelectorList,
  MAX_PAGE_TEXT_LENGTH,
  MAX_PAGE_TEXT_SELECTORS,
  normalizePageText,
  parsePageTextCapture,
} from "../../src/shared/page-text-capture.ts";

describe("captured page text contract", () => {
  test.each([
    ["  example_author  ", "example_author"],
    ["first\n\t  second third", "first second third"],
    ["", ""],
    [" \n\t ", ""],
    ["x".repeat(MAX_PAGE_TEXT_LENGTH + 40), "x".repeat(MAX_PAGE_TEXT_LENGTH)],
    // The bound must not leave a trailing space behind for the cut it made.
    [`${"x".repeat(MAX_PAGE_TEXT_LENGTH - 1)} tail`, "x".repeat(MAX_PAGE_TEXT_LENGTH - 1)],
  ])("normalizes %j", (value, expected) => {
    expect(normalizePageText(value)).toBe(expected);
    expect(normalizePageText(expected)).toBe(expected);
  });

  test("accepts a bounded list of non-empty selectors", () => {
    expect(isPageTextSelectorList([])).toBe(true);
    expect(isPageTextSelectorList(["header .author", "x".repeat(512)])).toBe(true);
    expect(
      isPageTextSelectorList(
        Array.from({ length: MAX_PAGE_TEXT_SELECTORS }, (_value, i) => `.s${i}`),
      ),
    ).toBe(true);
  });

  test.each([
    ["nothing", undefined],
    ["a single selector string", "header .author"],
    ["an empty selector", [""]],
    ["a non-string selector", [7]],
    ["an oversized selector", ["x".repeat(513)]],
    [
      "more selectors than rules may capture",
      Array.from({ length: MAX_PAGE_TEXT_SELECTORS + 1 }, (_value, i) => `.s${i}`),
    ],
  ])("rejects a selector list that is %s", (_label, value) => {
    expect(isPageTextSelectorList(value)).toBe(false);
  });

  test("accepts canonical selector and text pairs", () => {
    expect(isPageTextCapture([])).toBe(true);
    expect(isPageTextCapture([["header .author", "example author"]])).toBe(true);
    expect(isPageTextCapture([["a", "x".repeat(MAX_PAGE_TEXT_LENGTH)]])).toBe(true);
    expect(
      isPageTextCapture(
        Array.from({ length: MAX_PAGE_TEXT_SELECTORS }, (_value, i) => [`.s${i}`, "text"]),
      ),
    ).toBe(true);
  });

  test.each([
    ["nothing", undefined],
    ["a record", { "header .author": "example" }],
    ["a bare pair", ["header .author", "example"]],
    ["a pair with a missing text", [["header .author"]]],
    ["a pair with an extra member", [["header .author", "example", "more"]]],
    ["an empty selector", [["", "example"]]],
    ["an oversized selector", [["x".repeat(513), "example"]]],
    ["a non-string selector", [[7, "example"]]],
    ["a non-string text", [["a", 7]]],
    ["an empty text", [["a", ""]]],
    ["text with outer whitespace", [["a", " example "]]],
    ["text with uncollapsed whitespace", [["a", "first\nsecond"]]],
    ["text over the length bound", [["a", "x".repeat(MAX_PAGE_TEXT_LENGTH + 1)]]],
    [
      "more pairs than rules may capture",
      Array.from({ length: MAX_PAGE_TEXT_SELECTORS + 1 }, (_value, i) => [`.s${i}`, "text"]),
    ],
  ])("rejects a capture that is %s", (_label, value) => {
    expect(isPageTextCapture(value)).toBe(false);
    expect(parsePageTextCapture(value, ["a", "header .author"])).toBeUndefined();
  });

  test("a bridge answer speaks only for the selectors that were asked about", () => {
    expect(
      parsePageTextCapture(
        [
          ["header .author", "example"],
          [".unasked", "other"],
        ],
        ["header .author", ".absent"],
      ),
    ).toEqual([["header .author", "example"]]);
    expect(parsePageTextCapture([], ["header .author"])).toEqual([]);
  });
});
