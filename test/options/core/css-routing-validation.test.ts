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

test("Options supplies a stable fallback when a locale lacks the CSS error", () => {
  vi.mocked(browser.i18n.getMessage).mockReturnValue("");

  expect(cssSelectorErrors("css: [\ninto: files/")).toEqual([
    expect.objectContaining({ message: "Invalid CSS selector" }),
  ]);
});
