// @vitest-environment jsdom

import { parseRulesCollecting } from "../../src/routing/rule-parser.ts";
import {
  cssSelectorsForRules,
  matchedCssSelectorsByOrigin,
  sourceOriginElements,
} from "../../src/content/css-routing.ts";
import { mergePageSourcesByUrl } from "../../src/content/source-panel-model.ts";
import { collectPageSourceCandidates } from "../../src/content/source-panel-model.ts";

const rulesWithCss = (...selectors: string[]) =>
  parseRulesCollecting(`${selectors.map((selector) => `css: ${selector}`).join("\n")}\ninto: x/`)
    .rules;

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
      matchedCssSelectorsByOrigin(
        [hero, avatar],
        rulesWithCss("article img, video", "img:not(.avatar)"),
      ),
    ).toEqual([["article img, video", "img:not(.avatar)"]]);
  });

  test("emits a rule proof only when one origin satisfies every CSS clause", () => {
    const articleImage = document.createElement("img");
    articleImage.className = "article";
    const fullSizeImage = document.createElement("img");
    fullSizeImage.className = "full-size";
    const rules = rulesWithCss(".article", ".full-size");

    expect(matchedCssSelectorsByOrigin([articleImage, fullSizeImage], rules)).toEqual([]);
    fullSizeImage.classList.add("article");
    expect(matchedCssSelectorsByOrigin([articleImage, fullSizeImage], rules)).toEqual([
      [".article", ".full-size"],
    ]);
  });

  test("contains invalid stored selectors and omits resource hints", () => {
    const image = document.createElement("img");
    const storedRules = parseRulesCollecting(
      "css: [\ninto: invalid/\n\ncss: img\ninto: valid/",
    ).rules;
    expect(matchedCssSelectorsByOrigin([image], storedRules)).toEqual([["img"]]);
    expect(
      sourceOriginElements({
        url: "https://example.test/stream.m3u8",
        kind: "stream",
        channel: "resource-hint",
        element: image,
      }),
    ).toEqual([]);
  });

  test("preserves escaped trailing whitespace in native CSS selectors", () => {
    const element = document.createElement("div");
    element.id = "escaped ";
    const parsed = parseRulesCollecting("css: #escaped\\ \ninto: escaped/");

    expect(parsed.rules[0]?.[0]).toMatchObject({ value: "#escaped\\ " });
    expect(matchedCssSelectorsByOrigin([element], parsed.rules)).toEqual([["#escaped\\ "]]);
  });

  test("does not turn a merged resource hint placeholder into a DOM origin", () => {
    const image = document.createElement("img");
    const timingPlaceholder = document.body;
    const real = { url: "https://example.test/shared.png", kind: "image" as const, element: image };
    const hint = {
      url: "https://example.test/shared.png",
      kind: "stream" as const,
      channel: "resource-hint" as const,
      element: timingPlaceholder,
    };

    for (const sources of [
      [real, hint],
      [hint, real],
    ]) {
      const merged = mergePageSourcesByUrl(sources);
      expect(sourceOriginElements(merged[0]!)).toEqual([image]);
      expect(
        matchedCssSelectorsByOrigin(sourceOriginElements(merged[0]!), rulesWithCss("body")),
      ).toEqual([]);
    }
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
        ? matchedCssSelectorsByOrigin(
            sourceOriginElements(responsive),
            rulesWithCss("article picture img"),
          )
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
    expect(
      matchedCssSelectorsByOrigin(sourceOriginElements(rescanned[0]!), rulesWithCss(".avatar")),
    ).toEqual([]);
  });

  test("extracts unique raw CSS selectors from parsed rules", () => {
    const parsed = parseRulesCollecting(
      "css: article img\ninto: a/\n\ncss: article img\ncss: .hero\ninto: b/",
    );
    expect(cssSelectorsForRules(parsed.rules)).toEqual(["article img", ".hero"]);
  });

  test("bounds selector attestations and drops duplicate origin groups", () => {
    expect(matchedCssSelectorsByOrigin([document.body], [])).toEqual([]);

    const duplicateA = document.createElement("img");
    const duplicateB = document.createElement("img");
    expect(matchedCssSelectorsByOrigin([duplicateA, duplicateB], rulesWithCss("img"))).toEqual([
      ["img"],
    ]);

    const one = document.createElement("div");
    const selectorsAtLimit = Array.from({ length: 256 }, (_value, index) => `.match-${index}`);
    one.className = selectorsAtLimit.map((selector) => selector.slice(1)).join(" ");
    const rulesAtLimit = parseRulesCollecting(
      selectorsAtLimit
        .map((selector, index) => `css: ${selector}\ninto: match-${index}/`)
        .join("\n\n"),
    ).rules;
    expect(matchedCssSelectorsByOrigin([one], rulesAtLimit)).toHaveLength(256);

    const origins = Array.from({ length: 33 }, (_, index) => {
      const element = document.createElement("div");
      element.className = `origin-${index}`;
      return element;
    });
    const selectors = origins.map((_, index) => `.origin-${index}`);
    const rules = parseRulesCollecting(
      selectors.map((selector, index) => `css: ${selector}\ninto: ${index}/`).join("\n\n"),
    ).rules;
    expect(matchedCssSelectorsByOrigin(origins, rules)).toHaveLength(33);
  });

  test("rejects selectors beyond the bounded attestation contract", () => {
    const source = Array.from(
      { length: 257 },
      (_, index) => `css: img:not([data-${index}])\ninto: images/${index}/`,
    ).join("\n\n");
    const parsed = parseRulesCollecting(source);

    expect(parsed.rules).toEqual([]);
    expect(parsed.errors).toContainEqual(
      expect.objectContaining({
        message: "ruleTooManyCssSelectors",
        error: "img:not([data-256])",
      }),
    );
  });
});
