import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("gives Page sources settings a clear heading and intro hierarchy", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );
  const heading = document.querySelector("#section-page-sources")!;
  const intro = heading.nextElementSibling!;
  const groups = [
    ...document.querySelectorAll(".source-panel-settings, .source-shortcut-settings"),
  ];

  expect(intro.classList.contains("source-panel-intro")).toBe(true);
  expect(intro.querySelector(".section-lead")).not.toBeNull();
  expect(intro.querySelector(".section-note")).not.toBeNull();
  expect(groups.map((group) => group.querySelector("legend")?.className)).toEqual([
    "option-group-heading",
    "option-group-heading",
  ]);
  expect(document.querySelector(".source-shortcut-controls #sourcePanelShortcut")).not.toBeNull();
});

test("keeps variables in Live variables and clauses in their own disclosure", () => {
  const document = new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );

  expect(document.querySelector("#paths-insert-menu")).toBeNull();
  expect(document.querySelector("#rules-insert-menu")).toBeNull();
  expect(document.querySelector("#rules-clause-menu summary")?.textContent).toContain(
    "__MSG_o_lClauses__",
  );
});
