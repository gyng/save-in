import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("places the directory definitions heading above the editor mode tabs", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );
  const heading = document.querySelector("#paths-editor-label")!;
  const tabs = document.querySelector(".paths-editor .editor-tabs")!;

  expect(heading.nextElementSibling).toBe(tabs);
  expect(document.querySelector("#paths")?.getAttribute("aria-labelledby")).toBe(
    "paths-editor-label",
  );
  expect(document.querySelector("#paths-text-actions #paths-editor-description")).not.toBeNull();
});
