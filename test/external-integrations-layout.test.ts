import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("places external download access directly on the page without an outer card", () => {
  const html = readFileSync(resolve("src/options/options.html"), "utf8");
  const css = readFileSync(resolve("src/options/style.css"), "utf8");
  const heading = html.indexOf('id="external-download-access-heading"');
  const content = html.indexOf('class="external-integrations-content"');

  expect(heading).toBeGreaterThan(-1);
  expect(content).toBeGreaterThan(heading);
  expect(html).not.toContain("external-integrations-card");
  expect(css).not.toContain(".external-integrations-card");
});
