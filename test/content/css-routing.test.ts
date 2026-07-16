// @vitest-environment jsdom

import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import {
  cssSelectorsForRules,
  matchedCssSelectorsByOrigin,
  sourceOriginElements,
} from "../../src/content/css-routing.ts";
import { mergePageSourcesByUrl } from "../../src/content/source-panel-model.ts";

describe("content CSS routing", () => {
  test("uses native comma-list semantics and keeps matches grouped by origin", () => {
    document.body.innerHTML = `
      <article><img id="hero"></article>
      <aside><img id="avatar" class="avatar"></aside>
    `;
    const hero = document.querySelector("#hero");
    const avatar = document.querySelector("#avatar");
    expect(hero).toBeInstanceOf(Element);
    expect(avatar).toBeInstanceOf(Element);
    if (!(hero instanceof Element) || !(avatar instanceof Element)) return;

    expect(
      matchedCssSelectorsByOrigin([hero, avatar], ["article img, video", "img:not(.avatar)"]),
    ).toEqual([["article img, video", "img:not(.avatar)"]]);
  });

  test("contains invalid stored selectors and omits resource hints", () => {
    const image = document.createElement("img");
    expect(matchedCssSelectorsByOrigin([image], ["[", "img"])).toEqual([["img"]]);
    expect(
      sourceOriginElements({
        url: "https://example.test/stream.m3u8",
        kind: "stream",
        channel: "resource-hint",
        element: image,
      }),
    ).toEqual([]);
  });

  test("retains every origin when panel rows merge duplicate URLs", () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    const merged = mergePageSourcesByUrl([
      { url: "https://example.test/shared.jpg", kind: "image", element: first },
      { url: "https://example.test/shared.jpg", kind: "image", element: second },
    ]);
    expect(sourceOriginElements(merged[0]!)).toEqual([first, second]);
  });

  test("extracts unique raw CSS selectors from parsed rules", () => {
    const parsed = parseRulesCollecting(
      "css: article img\ninto: a/\n\ncss: article img\ncss: .hero\ninto: b/",
    );
    expect(cssSelectorsForRules(parsed.rules)).toEqual(["article img", ".hero"]);
  });
});
