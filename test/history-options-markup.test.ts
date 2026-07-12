import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const optionsDocument = () =>
  new DOMParser().parseFromString(
    readFileSync(resolve("src/options/options.html"), "utf8"),
    "text/html",
  );

test("offers configurable history columns and explicit exports", () => {
  const document = optionsDocument();

  expect(document.querySelector("#history-column-options")).not.toBeNull();
  expect(document.querySelector("#history-export-json")?.textContent).toContain("Export JSON");
  expect(document.querySelector("#history-export-csv")?.textContent).toContain("Export CSV");
  expect(document.querySelector(".history-raw")).toBeNull();
  expect(document.querySelector(".history-export")).toBeNull();
  expect(document.querySelector(".history-actions > #history-export-json")).not.toBeNull();
  expect(document.querySelector('label[for="history-type-filter"]')?.closest("details")).toBeNull();
  expect(document.querySelector(".history-facets > .history-columns")).not.toBeNull();
});

test("shows a Page sources drawer preview", () => {
  const document = optionsDocument();
  const demo = document.querySelector(".source-panel-demo")!;

  expect(demo.getAttribute("aria-label")).toContain("Page sources");
  expect(demo.querySelectorAll(".source-panel-demo-row")).toHaveLength(2);
});
