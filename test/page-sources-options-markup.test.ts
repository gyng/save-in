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
  expect(
    document.querySelector(".preview-column .reference-sections #rules-clause-menu"),
  ).not.toBeNull();
  expect(document.querySelector("#rules-clause-menu .clause-preview-filter")).not.toBeNull();
  const references = document.querySelector(".rules-editor .reference-sections")!;
  expect(
    [...references.children].map((child) => child.querySelector("summary")?.textContent?.trim()),
  ).toEqual(["__MSG_o_lRuleTemplates__", "__MSG_o_lLiveVariables__", "__MSG_o_lClauses__"]);
  expect(
    document.querySelector(".rule-templates-panel .rule-templates-dropdown #rule-templates"),
  ).not.toBeNull();
});
