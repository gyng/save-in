// @vitest-environment jsdom

import { cssSelectorErrors } from "../../../src/options/core/css-selector-validation.ts";

test("Options uses the browser selector parser to reject invalid css matchers", () => {
  expect(cssSelectorErrors("css: article img\ninto: files/")).toEqual([]);
  expect(cssSelectorErrors("css: [\ninto: files/")).toEqual([
    expect.objectContaining({ error: "[" }),
  ]);
  expect(cssSelectorErrors("css: [\ninto: draft/\ndisabled: true")).toEqual([
    expect.objectContaining({ error: "[" }),
  ]);
  expect(cssSelectorErrors("css: [\ninto: files/\ndisabled: false")).toEqual([
    expect.objectContaining({ error: "[" }),
  ]);
  const escaped = document.createElement("div");
  escaped.id = "escaped ";
  expect(cssSelectorErrors("css: #escaped\\ \ninto: escaped/", escaped)).toEqual([]);
});

test("Options rejects an invalid csstext selector the same way", () => {
  expect(cssSelectorErrors("csstext: header .author\ninto: authors/:csstext:/")).toEqual([]);
  expect(cssSelectorErrors("csstext: [\ninto: authors/:csstext:/")).toEqual([
    expect.objectContaining({
      message: "Translated<ruleInvalidCssSelector>",
      error: "[",
      location: { start: 9, end: 10, line: 1, column: 9 },
    }),
  ]);
});

test("Options supplies a stable CSS error when localization is unavailable", () => {
  vi.spyOn(global.browser.i18n, "getMessage").mockReturnValue("");
  expect(cssSelectorErrors("css: [\ninto: files/")).toEqual([
    expect.objectContaining({ message: "Invalid CSS selector" }),
  ]);
});
