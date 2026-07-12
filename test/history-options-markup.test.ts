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
  expect(document.querySelector("#history-export-json")?.textContent).toContain("JSON");
  expect(document.querySelector("#history-export-csv")?.textContent).toContain("CSV");
  expect(document.querySelector("#history-export-tsv")?.textContent).toContain("TSV");
  expect(document.querySelector(".history-export-menu")).not.toBeNull();
  expect(document.querySelector(".history-raw")).toBeNull();
  expect(document.querySelector(".history-export")).toBeNull();
  expect(
    document.querySelector(".history-table-tools .history-export-menu #history-export-json"),
  ).not.toBeNull();
  expect(document.querySelector('label[for="history-type-filter"]')?.closest("details")).toBeNull();
  expect(document.querySelector(".history-table-tools > .history-columns")).not.toBeNull();
  for (const id of [
    "history-filter",
    "history-source-filter",
    "history-status-filter",
    "history-type-filter",
    "history-date-preset",
    "history-date-from",
    "history-date-to",
  ]) {
    expect(document.getElementById(id)?.getAttribute("data-runtime-control")).toBe("true");
  }

  expect(document.querySelector('label[for="history-date-preset"]')?.textContent).toContain(
    "__MSG_o_lHistoryDateSaved__",
  );
  expect(document.querySelector("#history-custom-date-range")?.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector("#history-clear-filters")?.hasAttribute("hidden")).toBe(true);
  expect(document.querySelector("#history-active-filters[aria-live]")).not.toBeNull();
  expect(document.querySelector("#history-clear")?.textContent).toContain(
    "__MSG_o_cDeleteAllHistory__",
  );
});

test("shows a Page sources drawer preview", () => {
  const document = optionsDocument();
  const demo = document.querySelector(".source-panel-demo")!;

  expect(demo.getAttribute("aria-label")).toContain("Page sources");
  expect(demo.querySelectorAll(".source-panel-demo-row")).toHaveLength(3);
  expect(demo.querySelectorAll(".source-panel-demo-actions svg")).toHaveLength(3);
  expect(demo.querySelector(".source-panel-demo-search svg")).not.toBeNull();
  expect(demo.querySelectorAll(".source-panel-demo-facets b")).toHaveLength(4);
  expect(demo.querySelectorAll(".source-panel-demo-details")).toHaveLength(3);
});
