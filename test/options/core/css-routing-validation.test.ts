// @vitest-environment jsdom

import { cssSelectorErrors } from "../../../src/options/core/css-selector-validation.ts";

test("Options uses the browser selector parser to reject invalid css matchers", () => {
  expect(cssSelectorErrors("css: article img\ninto: files/")).toEqual([]);
  expect(cssSelectorErrors("css: [\ninto: files/")).toEqual([
    expect.objectContaining({ error: "[" }),
  ]);
});
