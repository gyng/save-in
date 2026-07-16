// @vitest-environment jsdom

import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import {
  cssSelectorsForRules,
  matchedCssSelectorsByOrigin,
  sourceOriginElements,
} from "../../src/content/css-routing.ts";
import { mergePageSourcesByUrl } from "../../src/content/source-panel-model.ts";
import { collectPageSourceCandidates } from "../../src/content/source-panel-model.ts";

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

  test("uses the owning image as the origin for picture source candidates", () => {
    document.body.innerHTML = `
      <article>
        <picture><source srcset="large.jpg 2x"><img src="fallback.jpg"></picture>
      </article>`;
    const image = document.querySelector("img");
    const responsive = collectPageSourceCandidates(document, {
      includeBackgrounds: false,
      resourceHints: false,
    }).find(({ url }) => url.endsWith("large.jpg"));

    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(responsive?.element).toBe(image);
    expect(
      responsive
        ? matchedCssSelectorsByOrigin(sourceOriginElements(responsive), ["article picture img"])
        : [],
    ).toEqual([["article picture img"]]);
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

  test("does not persist removed origins on reusable collector records", () => {
    const retained = document.createElement("img");
    const removed = document.createElement("img");
    removed.className = "avatar";
    const retainedCandidate = {
      url: "https://example.test/shared.jpg",
      kind: "image" as const,
      element: retained,
    };
    mergePageSourcesByUrl([retainedCandidate, { ...retainedCandidate, element: removed }]);

    expect(sourceOriginElements(retainedCandidate)).toEqual([retained, removed]);
    const rescanned = mergePageSourcesByUrl([retainedCandidate]);
    expect(sourceOriginElements(rescanned[0]!)).toEqual([retained]);
    expect(matchedCssSelectorsByOrigin(sourceOriginElements(rescanned[0]!), [".avatar"])).toEqual(
      [],
    );
  });

  test("extracts unique raw CSS selectors from parsed rules", () => {
    const parsed = parseRulesCollecting(
      "css: article img\ninto: a/\n\ncss: article img\ncss: .hero\ninto: b/",
    );
    expect(cssSelectorsForRules(parsed.rules)).toEqual(["article img", ".hero"]);
  });

  test("rejects selectors beyond the bounded attestation contract", () => {
    const source = Array.from(
      { length: 65 },
      (_, index) => `css: img:not([data-${index}])\ninto: images/${index}/`,
    ).join("\n\n");
    const parsed = parseRulesCollecting(source);

    expect(cssSelectorsForRules(parsed.rules)).toHaveLength(64);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        message: "ruleTooManyCssSelectors",
        error: "img:not([data-64])",
      }),
    );
  });
});
