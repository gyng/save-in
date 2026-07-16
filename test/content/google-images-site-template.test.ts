// @vitest-environment jsdom

import { collectPageSources } from "../../src/content/source-panel-model.ts";
import { RULE_TEMPLATES } from "../../src/options/rule-editor/rule-templates.ts";
import { matchRules, parseRulesCollecting } from "../../src/routing/router.ts";

test("the Google Images details-pane template selects the publisher image without DOM selectors", () => {
  document.body.innerHTML = `
    <main>
      <img id="grid-result" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:grid">
      <aside aria-label="Image details">
        <img id="branding" src="https://www.gstatic.com/images/branding/googlelogo.png">
        <img id="publisher-image" src="https://images.publisher.test/photos/landscape.jpg">
      </aside>
    </main>`;

  const template = RULE_TEMPLATES.find(
    (candidate) => candidate.name === "Google Images source image",
  );
  expect(template).toBeDefined();
  const parsed = parseRulesCollecting(template?.rule ?? "");
  expect(parsed.errors).toEqual([]);

  const matched = collectPageSources(document, {
    includeBackgrounds: false,
    includeLinks: false,
    resourceHints: false,
  }).filter((source) =>
    matchRules(parsed.rules, {
      pageUrl: "https://www.google.com/search?udm=2&q=landscape",
      sourceUrl: source.url,
      sourceKind: source.kind,
      filename: source.url.split("/").at(-1),
    }),
  );

  expect(matched.map(({ element, url, kind }) => [element.id, url, kind])).toEqual([
    ["publisher-image", "https://images.publisher.test/photos/landscape.jpg", "image"],
  ]);
});
