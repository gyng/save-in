// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  enhanceReferenceTables,
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

const referenceMessage = (key: string, substitutions?: string | number | (string | number)[]) => {
  const value = Array.isArray(substitutions) ? substitutions[0] : substitutions;
  return (
    {
      referenceCaption: "Reference",
      referenceColumnSyntax: "Syntax",
      referenceColumnExample: "Example",
      referenceColumnMeaning: "Meaning",
      referenceResult: `${value} result`,
      referenceResults: `${value} results`,
      referenceCopyValue: `Copy ${value}`,
      referenceCopiedValue: `Copied ${value}`,
    }[key] || ""
  );
};

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
      referenceMessage,
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

  afterEach(() => vi.useRealTimers());

  test("filters rows by syntax and description", () => {
    expect(filterReferenceRows(document, "source")).toBe(1);
    expect(document.querySelectorAll("tr[hidden]")).toHaveLength(1);
    expect(filterReferenceRows(document, "")).toBe(2);
  });

  test("turns copy tokens into keyboard-operable controls", () => {
    setupReferencePage(
      document,
      vi.fn(async () => {}),
      referenceMessage,
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

  test("handles empty references and falls back runtime descriptions", () => {
    expect(() =>
      syncReferenceVocabulary(document.createDocumentFragment(), "variables", []),
    ).not.toThrow();
    syncReferenceVocabulary(document, "variables", [":runtime:"], () => "");
    expect(document.body.textContent).toContain("Runtime variable");

    document.body.innerHTML =
      "<table><tbody><tr><td><code>filename:</code></td><td>Existing</td></tr></tbody></table>";
    syncReferenceVocabulary(document, "clauses", ["runtime:"], () => "");
    expect(document.body.textContent).toContain("Runtime rule matcher");
  });

  test("ignores reference rows without a table parent", () => {
    const orphan = document.createElement("tr");
    const root = {
      querySelectorAll: () => [orphan],
    } as unknown as ParentNode;

    expect(() => syncReferenceVocabulary(root, "variables", [":date:"])).not.toThrow();
  });

  test("filters grouped tables and their containing sections", () => {
    document.body.innerHTML = `<section class="reference-section"><table><tbody>
      <tr><td><code>:date:</code></td><td>Date</td></tr>
      <tr><td><code>:year:</code></td><td>Year</td></tr>
      <tr><td><code>:filename:</code></td><td>File</td></tr>
    </tbody></table></section>`;
    groupReferenceRows(document, "variables");
    groupReferenceRows(document, "variables");
    enhanceReferenceTables(document);
    expect(filterReferenceRows(document, "file")).toBe(1);
    expect(document.querySelectorAll(".reference-group-row[hidden]").length).toBeGreaterThan(0);
    expect(filterReferenceRows(document, "missing")).toBe(0);
    expect(document.querySelector("table")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".reference-section")?.hidden).toBe(true);
  });

  test("enhances empty and direct-row tables without duplicating existing structure", () => {
    document.body.innerHTML = `<table id="empty"></table>
      <h2>Custom title</h2>
      <div id="help-clause-list"><table id="clause"><caption>Existing</caption><thead><tr><th>Syntax</th></tr></thead><tbody><tr><th>into:</th><td><code>folder</code></td></tr><tr></tr></tbody></table></div>`;
    const direct = document.createElement("table");
    direct.id = "direct";
    const row = document.createElement("tr");
    row.innerHTML = "<td><code>a:</code></td><td><code>raw</code></td>";
    direct.append(row);
    document.querySelector("h2")!.after(direct);
    enhanceReferenceTables(document);
    expect(document.querySelector("#empty thead")).toBeNull();
    expect(document.querySelector("#direct tbody")).not.toBeNull();
    expect(document.querySelector("#direct caption")?.textContent).toBe("Custom title");
    expect(document.querySelector("#clause caption")?.textContent).toBe("Existing");
    expect(document.querySelector("#clause td code")).toBeNull();
  });

  test("repairs an existing empty table header", () => {
    document.body.innerHTML = `<table id="missing-header"><thead></thead><tbody>
      <tr><td><code>:date:</code></td><td>Current date</td></tr>
    </tbody></table>`;

    enhanceReferenceTables(document, referenceMessage);

    expect(
      [...document.querySelectorAll("#missing-header thead th")].map((cell) => cell.textContent),
    ).toEqual(["Syntax", "Meaning"]);
  });

  test("loads runtime vocabulary, filters counts, copies by pointer and keyboard, and secures links", async () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<a class="external" href="https://x.test">X</a>',
    );
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({
      body: { variables: [":date:", ":runtime:"], matchers: ["filename"] },
    });
    const copy = vi.fn(() => Promise.resolve());
    setupReferencePage(document, copy, referenceMessage);
    await vi.waitFor(() => expect(document.body.textContent).toContain(":runtime:"));
    const search = document.querySelector<HTMLInputElement>(".reference-search")!;
    search.value = ":runtime:";
    search.dispatchEvent(new InputEvent("input"));
    expect(document.querySelector(".reference-count")?.textContent).toBe("1 result");

    const token = [...document.querySelectorAll<HTMLElement>(".click-to-copy")].find(
      (candidate) => candidate.textContent === ":runtime:",
    )!;
    vi.useFakeTimers();
    token.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(":runtime:"));
    expect(token.classList.contains("copied")).toBe(true);
    expect(document.querySelector(".reference-copy-status")?.textContent).toBe("Copied :runtime:");
    await vi.advanceTimersByTimeAsync(1000);
    expect(token.classList.contains("copied")).toBe(false);
    token.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    document.body.click();
    expect(document.querySelector<HTMLAnchorElement>("a.external")?.target).toBe("_blank");
    expect(document.querySelector<HTMLAnchorElement>("a.external")?.rel).toContain("noreferrer");
    vi.useRealTimers();
  });

  test("supports sparse controls, empty tokens, and non-token events", async () => {
    document.body.innerHTML = `<table><tbody>
      <tr><td></td><td>Missing syntax</td></tr>
      <tr><td><code class="click-to-copy"></code></td><td>Empty syntax</td></tr>
    </tbody></table>`;
    vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(new Error("offline"));
    const copy = vi.fn(() => Promise.resolve());
    setupReferencePage(document, copy, referenceMessage);

    const emptyToken = document.querySelector<HTMLElement>(".click-to-copy")!;
    expect(emptyToken.getAttribute("aria-label")).toBe("Copy value");
    document.dispatchEvent(new Event("click", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    emptyToken.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(""));
  });

  test("uses readable table, result, and copy fallbacks without localization", async () => {
    vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(new Error("offline"));
    const copy = vi.fn(() => Promise.resolve());
    setupReferencePage(document, copy, () => "");

    expect(document.querySelector("caption")?.textContent).toBe("Reference");
    expect([...document.querySelectorAll("thead th")].map((cell) => cell.textContent)).toEqual([
      "Syntax",
      "Meaning",
    ]);
    expect(document.querySelector(".reference-count")?.textContent).toBe("2 results");
    const search = document.querySelector<HTMLInputElement>(".reference-search")!;
    search.value = "date";
    search.dispatchEvent(new InputEvent("input"));
    expect(document.querySelector(".reference-count")?.textContent).toBe("1 result");

    const token = document.querySelector<HTMLElement>(".click-to-copy")!;
    expect(token.getAttribute("aria-label")).toBe("Copy :date:");
    token.click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(":date:"));
    expect(document.querySelector(".reference-copy-status")?.textContent).toBe("Copied :date:");
  });

  test("updates clause vocabulary without optional search and count controls", async () => {
    document.body.innerHTML = `<div id="help-clause-list"><table><tbody>
      <tr><td><code>filename:</code></td><td>Filename matcher</td></tr>
    </tbody></table></div>`;
    vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce({
      body: { variables: [], matchers: ["runtime"] },
    });
    setupReferencePage(
      document,
      vi.fn(() => Promise.resolve()),
      referenceMessage,
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain("runtime:"));
    expect(document.body.textContent).toContain("capture:");
  });

  test.each([
    () => Promise.reject(new Error("offline")),
    () => Promise.resolve({ body: { variables: [] } }),
    () => Promise.resolve({ body: { variables: "bad", matchers: [] } }),
  ])("keeps authored rows for unavailable runtime vocabulary", async (response) => {
    vi.mocked(browser.runtime.sendMessage).mockReturnValueOnce(response() as never);
    setupReferencePage(
      document,
      vi.fn(() => Promise.resolve()),
      referenceMessage,
    );
    await Promise.resolve();
    expect(document.body.textContent).toContain(":date:");
  });
});

test("keeps variables and clauses together in the options reference dialog", () => {
  const document = parse("options");
  expect(document.querySelector("#options-reference-variables[role=tabpanel]")).not.toBeNull();
  expect(document.querySelector("#options-reference-clauses[role=tabpanel]")).not.toBeNull();
});

test("adds semantic group headings to both vocabularies", () => {
  const variables = parse("options");
  groupReferenceRows(variables.querySelector("#options-reference-variables")!, "variables");
  expect(variables.querySelector('th[scope="colgroup"]')).not.toBeNull();

  const clauses = parse("clauselist");
  groupReferenceRows(clauses, "clauses");
  expect(clauses.querySelector('th[scope="colgroup"]')).not.toBeNull();
});
