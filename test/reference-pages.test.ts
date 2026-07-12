import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe.each(["variablelist", "clauselist"])("%s reference surface", (name) => {
  test("has navigation, search, copy status, and responsive reference styling", () => {
    const document = parse(name);
    expect(document.querySelector('a[href="options.html"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>(".reference-search")?.type).toBe("search");
    expect(document.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
    expect(document.querySelector('link[href="reference.css"]')).not.toBeNull();
    expect(document.querySelector('script[src="reference-page.js"]')).not.toBeNull();
  });

  test("uses table captions, column headers, and row headers", () => {
    const document = parse(name);
    setupReferencePage(
      document,
      vi.fn(async () => {}),
    );
    for (const table of document.querySelectorAll("table")) {
      expect(table.querySelector("caption")).not.toBeNull();
      expect(table.querySelectorAll('thead th[scope="col"]').length).toBeGreaterThan(0);
      expect(table.querySelectorAll('tbody th[scope="row"]').length).toBeGreaterThan(0);
    }
  });

  test("does not repeat the active reference name as an in-panel heading", () => {
    expect(parse(name).querySelector(".reference-panel > h2, #help-clause-list > h2")).toBeNull();
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
    syncReferenceVocabulary(document, "variables", [":date:", ":newvalue:"]);
    const tokens = [...document.querySelectorAll("tbody tr code:first-child")].map((node) =>
      node.textContent?.trim(),
    );
    expect(tokens).toEqual([":date:", ":newvalue:", ":$1:"]);
    expect(document.body.textContent).toContain("Runtime variable");
    expect(document.body.textContent).not.toContain(":sourceurl:");
  });
});

test("every runtime variable and matcher is documented", () => {
  const variables = readFileSync(resolve("src/options/variablelist.html"), "utf8");
  const clauses = readFileSync(resolve("src/options/clauselist.html"), "utf8");
  for (const token of [
    ":urlfileext:",
    ":actualfileext:",
    ":naivefileext:",
    ":mimeext:",
    ":sha256:",
  ])
    expect(variables).toContain(token);
  for (const clause of [
    "context:",
    "menuindex:",
    "comment:",
    "fileext:",
    "urlfileext:",
    "actualfileext:",
    "filename:",
    "frameurl:",
    "linktext:",
    "mediatype:",
    "naivefilename:",
    "pagedomain:",
    "pagetitle:",
    "pageurl:",
    "selectiontext:",
    "sourcedomain:",
    "sourceurl:",
    "capture:",
    "into:",
  ])
    expect(clauses).toContain(clause);
});

test("combines variables and clauses behind accessible tabs", () => {
  const document = parse("variablelist");
  expect(document.querySelectorAll('.reference-tabs [role="tab"]')).toHaveLength(2);
  expect(document.querySelector("#reference-variables[role=tabpanel]")).not.toBeNull();
  expect(
    document.querySelector("#reference-clauses[data-source='clauselist.html']"),
  ).not.toBeNull();
});

test("adds task-oriented group rows to both vocabularies", () => {
  const variables = parse("variablelist");
  groupReferenceRows(variables.querySelector("#reference-variables")!, "variables");
  expect(
    [...variables.querySelectorAll(".reference-group-row")].map((row) => row.textContent),
  ).toContain("Date and time");

  const clauses = parse("clauselist");
  groupReferenceRows(clauses, "clauses");
  expect(
    [...clauses.querySelectorAll(".reference-group-row")].map((row) => row.textContent),
  ).toContain("Output");
});
