import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("places manual-save guidance directly after each editor action row", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );
  const helpers = [...document.querySelectorAll(".manual-save-help")];

  expect(helpers).toHaveLength(2);
  expect(
    helpers.every((helper) => helper.previousElementSibling?.classList.contains("editor-actions")),
  ).toBe(true);
});
