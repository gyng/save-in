// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { matcherFunctions } from "../src/routing/matchers.ts";
import { transformers } from "../src/routing/variable.ts";
import {
  filterReferenceRows,
  groupReferenceRows,
  setupReferencePage,
  syncReferenceVocabulary,
} from "../src/options/reference-page.ts";

const parse = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(resolve("src/options", `${name}.html`), "utf8"),
    "text/html",
  );

describe("clauselist reference surface", () => {
  const name = "clauselist";
  test("has semantic search and copy-status controls", () => {
    const document = parse(name);
    expect(document.querySelector<HTMLInputElement>(".reference-search")?.type).toBe("search");
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });

  test("uses table captions, column headers, and row headers", () => {
    const document = parse(name);
    setupReferencePage(
      document,
      vi.fn(async () => {}),
    );
    for (const table of document.querySelectorAll("table")) {
      expect(table.querySelector("caption")).not.toBeNull();
      const columnCount = Math.max(
        ...[
          ...table.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.reference-group-row)"),
        ].map((row) => row.cells.length),
      );
      expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(columnCount);
      expect(table.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0);
    }
  });
});

describe("reference controller", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input class="reference-search"><span class="reference-count"></span>
      <div class="reference-copy-status" role="status"></div>
      <table><tbody>
        <tr><th><code class="click-to-copy">:date:</code></th><td>Current date</td></tr>
        <tr><th><code class="click-to-copy">:sourceurl:</code></th><td>Source URL</td></tr>
      </tbody></table>`;
  });

  test("filters rows by syntax and description", () => {
    expect(filterReferenceRows(document, "source")).toBe(1);
    expect(document.querySelectorAll("tr[hidden]")).toHaveLength(1);
    expect(filterReferenceRows(document, "")).toBe(2);
  });

  test("turns copy tokens into keyboard-operable controls", () => {
    setupReferencePage(
      document,
      vi.fn(async () => {}),
    );
    const token = document.querySelector<HTMLElement>(".click-to-copy")!;
    expect(token.tabIndex).toBe(0);
    expect(token.getAttribute("role")).toBe("button");
    token.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(token.getAttribute("aria-label")).toContain(":date:");
  });

  test("syncs rows to the runtime vocabulary and adds fallbacks for new terms", () => {
    const getMessage = (key: string) =>
      ({
        referenceRuntimeVariable: "Localized runtime variable",
        referenceRuntimeRuleMatcher: "Localized runtime rule matcher",
      })[key] ?? "";
    syncReferenceVocabulary(document, "variables", [":date:", ":newvalue:"], getMessage);
    const tokens = [...document.querySelectorAll("tbody tr code:first-child")].map((node) =>
      node.textContent?.trim(),
    );
    expect(tokens).toEqual([":date:", ":newvalue:", ":$1:"]);
    expect(document.body.textContent).toContain("Localized runtime variable");
    expect(document.body.textContent).not.toContain(":sourceurl:");

    document.body.innerHTML =
      "<table><tbody><tr><td><code>into:</code></td><td>Existing matcher</td></tr></tbody></table>";
    syncReferenceVocabulary(document, "clauses", ["newmatcher:"], getMessage);
    expect(document.body.textContent).toContain("Localized runtime rule matcher");
  });
});

test("every runtime variable and matcher is documented", () => {
  const variables = readFileSync(resolve("src/options/options.html"), "utf8");
  const clauses = readFileSync(resolve("src/options/clauselist.html"), "utf8");
  for (const variable of Object.keys(transformers)) {
    const token = variable.startsWith(":") ? variable : `:${variable}:`;
    expect(variables).toContain(token);
  }
  for (const clause of [...Object.keys(matcherFunctions), "capture", "capturegroups", "into"])
    expect(clauses).toContain(`${clause}:`);
});

test("keeps variables and clauses together in the options reference dialog", () => {
  const document = parse("options");
  expect(document.querySelector("#options-reference-variables[role=tabpanel]")).not.toBeNull();
  expect(document.querySelector("#options-reference-clauses[role=tabpanel]")).not.toBeNull();
});

test("adds task-oriented group rows to both vocabularies", () => {
  const variables = parse("options");
  groupReferenceRows(variables.querySelector("#options-reference-variables")!, "variables");
  expect(
    [...variables.querySelectorAll(".reference-group-row")].map((row) => row.textContent),
  ).toContain("Date and time");

  const clauses = parse("clauselist");
  groupReferenceRows(clauses, "clauses");
  expect(
    [...clauses.querySelectorAll(".reference-group-row")].map((row) => row.textContent),
  ).toContain("Output");
});
