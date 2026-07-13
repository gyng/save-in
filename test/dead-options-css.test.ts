import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("retired options controls do not leave CSS behind", () => {
  const css = readFileSync(resolve("src/options/style.css"), "utf8");
  const retiredSelectors = [
    "about-mascot-status",
    "combo-dropdown",
    "combo-wrap",
    "deprecated-text",
    "float-right",
    "history-raw-text",
    "insert-menu",
    "section-actions",
  ];

  retiredSelectors.forEach((selector) => expect(css).not.toContain(selector));
});
