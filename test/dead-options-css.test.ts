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

test("retired palette tokens do not remain defined", () => {
  const css = readFileSync(resolve("src/options/style.css"), "utf8");
  for (const token of ["blue80", "grey80", "green50", "magenta50", "link-color-hover"]) {
    expect(css).not.toMatch(new RegExp(`--${token}\\s*:`));
  }
});
