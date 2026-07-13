import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("places the external download access heading above its settings card", () => {
  const html = readFileSync(resolve("src/options/options.html"), "utf8");
  const heading = html.indexOf('id="external-download-access-heading"');
  const card = html.indexOf('class="external-integrations-card"');

  expect(heading).toBeGreaterThan(-1);
  expect(card).toBeGreaterThan(heading);
  expect(html.slice(card, html.indexOf("</section>", card))).not.toContain(
    "__MSG_html_externalDownloadAccess__",
  );
});
