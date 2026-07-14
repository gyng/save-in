// @vitest-environment jsdom

import { setupRuleVisualEditor } from "../src/options/rule-visual-editor.ts";
import { EDITOR_VALIDATION_EVENT } from "../src/options/editor-validation.ts";

const element = <T extends Element>(selector: string): T => {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing test element: ${selector}`);
  return match;
};

describe("routing visual editor", () => {
  beforeEach(() => {
    localStorage.removeItem("saveInRulesEditorMode");
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `
      <button type="button" id="rules-mode-text" aria-selected="true">Text</button>
      <button type="button" id="rules-mode-visual" aria-selected="false">Visual</button>
      <div id="rules-text-editor">
        <textarea id="filenamePatterns">filename/i: \\.jpg$\ninto: images/:filename:</textarea>
        <div id="error-filenamePatterns"></div>
        <div class="routing-ide-actions"></div>
      </div>
      <div id="rules-visual" hidden>
        <div id="rule-editor-cards"></div>
        <button type="button" id="rule-editor-add">Add rule</button>
        <details class="rule-add-menu">
          <summary>More</summary>
          <button type="button" id="rule-editor-add-auto">Add automatic source rule</button>
          <button type="button" id="rule-editor-browse-templates">Browse templates</button>
        </details>
      </div>
      <button type="button" id="auto-download-manage-rules">Open routing rules</button>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    localStorage.removeItem("saveInRulesEditorMode");
  });

  test("defaults to Visual while keeping Text first in the tab order", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });

    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(true);
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(false);
    expect(
      [...document.querySelectorAll("#rules-mode-text, #rules-mode-visual")].map((tab) => tab.id),
    ).toEqual(["rules-mode-text", "rules-mode-visual"]);
    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(1);
    expect(element<HTMLInputElement>(".rule-clause-value").value).toBe("\\.jpg$");
    expect(
      [...document.querySelectorAll("#rules-visual input, #rules-visual select")].every(
        (control) => control.hasAttribute("id") || control.hasAttribute("name"),
      ),
    ).toBe(true);
  });

  test("restores an explicit Text preference", () => {
    localStorage.setItem("saveInRulesEditorMode", "text");

    setupRuleVisualEditor({ matchers: ["filename"] });

    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(true);
  });

  test("switches editor tabs with standard tab-list keys", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    const text = element<HTMLButtonElement>("#rules-mode-text");
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(element<HTMLElement>("#rules-visual").hidden).toBe(false);
    expect(document.activeElement).toBe(element("#rules-mode-visual"));

    element<HTMLButtonElement>("#rules-mode-visual").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
    expect(document.activeElement).toBe(text);
  });

  test("writes field edits back through the textarea input pipeline", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    const input = vi.fn();
    textarea.addEventListener("input", input);

    const value = element<HTMLInputElement>(".rule-clause-value");
    value.value = "\\.png$";
    value.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(textarea.value).toBe("filename/i: \\.png$\ninto: images/:filename:");
    expect(input).toHaveBeenCalledOnce();
  });

  test("marks, aggregates, and clears visual rule validation", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value =
      "fileext: pdf\ninto: pdfs/:weekday:-:naivefidlename:";
    setupRuleVisualEditor({ matchers: ["fileext"] });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    const card = element<HTMLElement>(".rule-editor-card");
    card.classList.add("has-validation-warning");

    textarea.dispatchEvent(
      new CustomEvent(EDITOR_VALIDATION_EVENT, {
        detail: {
          errors: [
            {
              message: "Path variable is not supported",
              error: ":naivefidlename:",
              location: { start: 34, end: 49, line: 2, column: 21 },
            },
          ],
        },
      }),
    );

    const row = element<HTMLElement>(".rule-clause-destination");
    expect(row.classList).toContain("has-validation-error");
    expect(card.classList).not.toContain("has-validation-warning");
    expect(row.title).toContain(":naivefidlename:");
    expect(row.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
    expect(row.querySelector("input")?.getAttribute("aria-describedby")).toBe(
      "error-filenamePatterns",
    );

    textarea.dispatchEvent(
      new CustomEvent(EDITOR_VALIDATION_EVENT, {
        detail: {
          errors: [
            { message: "Missing location", error: "ignored" },
            {
              message: "Before any rule",
              error: "ignored",
              location: { start: 0, end: 0, line: -1, column: 0 },
            },
            {
              message: "Rule warning",
              error: "",
              warning: true,
              location: { start: 50, end: 50, line: 3, column: 0 },
            },
            {
              message: "Second warning",
              error: "detail",
              warning: true,
              location: { start: 50, end: 50, line: 3, column: 0 },
            },
          ],
        },
      }),
    );

    expect(row.classList).not.toContain("has-validation-error");
    expect(row.querySelector("input")?.hasAttribute("aria-invalid")).toBe(false);
    expect(row.querySelector("input")?.hasAttribute("aria-describedby")).toBe(false);
    expect(card.classList).toContain("has-validation-warning");
    expect(card.title).toBe("Rule warning\nSecond warning: detail");

    textarea.dispatchEvent(
      new CustomEvent(EDITOR_VALIDATION_EVENT, {
        detail: {
          errors: [
            {
              message: "Rule error",
              error: "detail",
              location: { start: 50, end: 50, line: 3, column: 0 },
            },
          ],
        },
      }),
    );
    expect(card.classList).toContain("has-validation-error");

    textarea.dispatchEvent(new Event(EDITOR_VALIDATION_EVENT));
    expect(card.classList).not.toContain("has-validation-warning");
    expect(card.hasAttribute("title")).toBe(false);
  });

  test("toggles a rule with a disabled control clause", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();

    const enabled = element<HTMLInputElement>(".rule-editor-enabled");
    expect(enabled.checked).toBe(true);
    enabled.click();
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe(
      "filename/i: \\.jpg$\ninto: images/:filename:\ndisabled: true",
    );
    expect(element<HTMLElement>(".rule-editor-card").classList).toContain("is-disabled");

    element<HTMLInputElement>(".rule-editor-enabled").click();
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe(
      "filename/i: \\.jpg$\ninto: images/:filename:",
    );
  });

  test("gives repeated rule controls contextual accessible names", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });

    expect(element<HTMLElement>(".rule-editor-enabled-label").textContent).toContain("Enabled");
    expect(element<HTMLInputElement>(".rule-editor-enabled").getAttribute("aria-label")).toBe(
      "Rule 1 enabled",
    );
    expect(element<HTMLSelectElement>(".rule-clause-name").getAttribute("aria-label")).toBe(
      "Rule 1, condition 1: matcher",
    );
    expect(element<HTMLInputElement>(".rule-clause-value").getAttribute("aria-label")).toBe(
      "Rule 1, condition 1: pattern",
    );
    expect(element<HTMLInputElement>(".rule-clause-flag input").getAttribute("aria-label")).toBe(
      "Rule 1, condition 1: ignore case",
    );
    expect(
      element<HTMLInputElement>(".rule-clause-destination .rule-clause-value").getAttribute(
        "aria-label",
      ),
    ).toBe("Rule 1 destination");
    expect(
      element<HTMLButtonElement>('[data-rule-action="delete-clause"]').getAttribute("aria-label"),
    ).toBe("Delete condition 1 from rule 1");
    expect(element<HTMLElement>(".rule-editor-actions-trigger").getAttribute("aria-label")).toBe(
      "More actions for rule 1",
    );
  });

  test("adds, duplicates, reorders, and deletes rules without leaving Visual mode", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();

    element<HTMLButtonElement>("#rule-editor-add").click();
    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(2);
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toContain(
      "filename: .*\ninto: :filename:",
    );

    element<HTMLButtonElement>('[data-rule-action="duplicate"]').click();
    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(3);
    element<HTMLButtonElement>('[data-rule-action="down"]').click();
    element<HTMLButtonElement>('[data-rule-action="delete"]').click();
    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(2);
  });

  test("creates and identifies an enabled guarded automatic-source rule", () => {
    setupRuleVisualEditor({ matchers: ["context", "pageurl", "sourcekind"] });
    const menu = element<HTMLDetailsElement>(".rule-add-menu");
    menu.open = true;
    element<HTMLButtonElement>("#rule-editor-add-auto").click();

    const source = element<HTMLTextAreaElement>("#filenamePatterns").value;
    expect(source).toContain("context: ^auto$");
    expect(source).toContain("pageurl: ^https://example\\.com/");
    expect(source).toContain("sourcekind: ^image$");
    expect(source).not.toContain("disabled: true");
    expect(element<HTMLInputElement>(".rule-editor-enabled").checked).toBe(true);
    expect(document.querySelectorAll(".rule-editor-auto-badge")).toHaveLength(1);
    expect(menu.open).toBe(false);
  });

  test("closes add and rule menus when clicking outside or pressing Escape", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    const addMenu = element<HTMLDetailsElement>(".rule-add-menu");
    const ruleMenu = element<HTMLDetailsElement>(".rule-editor-card-actions");

    addMenu.open = true;
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(addMenu.open).toBe(false);

    ruleMenu.open = true;
    element<HTMLButtonElement>('[data-rule-action="duplicate"]').focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ruleMenu.open).toBe(false);
    expect(document.activeElement).toBe(ruleMenu.querySelector("summary"));

    addMenu.open = true;
    ruleMenu.open = true;
    addMenu.querySelector("summary")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ruleMenu.open).toBe(false);
  });

  test("opens the shared editor in Visual mode from Page Sources", () => {
    localStorage.setItem("saveInRulesEditorMode", "text");
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupRuleVisualEditor({ matchers: ["context", "pageurl", "sourcekind"] });

    element<HTMLButtonElement>("#auto-download-manage-rules").click();

    expect(element<HTMLElement>("#rules-visual").hidden).toBe(false);
    expect(element<HTMLDetailsElement>(".rule-add-menu").open).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(
      element("#rule-editor-add-auto"),
    );
  });

  test("renders malformed rules read-only and offers a direct Text-mode escape", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value =
      "filename: jpg\nnot a clause\ninto: images/:filename:";
    setupRuleVisualEditor({ matchers: ["filename"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();

    expect(element<HTMLElement>(".rule-editor-unsupported").textContent).toContain("line 2");
    element<HTMLButtonElement>(".rule-editor-edit-text").click();
    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(true);
    expect(element<HTMLTextAreaElement>("#filenamePatterns").selectionStart).toBeGreaterThan(0);
  });

  test("rebuilds after restored options and highlights debugger-selected rules", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    textarea.value += "\n\nfilename: png\ninto: png/:filename:";
    document.dispatchEvent(new Event("options-restored"));
    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(2);

    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", { detail: { ruleIndex: 1, line: 4 } }),
    );
    const selectedCard = element<HTMLElement>(
      '.rule-editor-card[data-rule-index="1"].is-debug-selected',
    );
    expect(document.querySelectorAll(".rule-editor-card.is-debug-selected")).toHaveLength(1);
    expect(document.activeElement).toBe(
      selectedCard.querySelector<HTMLSelectElement>(".rule-clause-name"),
    );
  });

  test("edits matcher, capture, destination, and card controls", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = [
      "// Documents",
      "filename/i: pdf",
      "capturegroups: filename",
      "into: documents/:filename:",
      "",
      "sourceurl: cdn",
      "into: images/:filename:",
    ].join("\n");
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    expect(document.querySelector(".rule-editor-meta")?.textContent).toContain("Documents");
    expect(
      [...document.querySelectorAll(".rule-clause-marker")].map((node) => node.textContent),
    ).toContain("$");

    const firstRow = element<HTMLElement>(".rule-clause-row");
    firstRow.click();
    expect(firstRow.classList).toContain("is-active");
    const secondRow = document.querySelectorAll<HTMLElement>(".rule-clause-row")[1]!;
    secondRow.click();
    expect(firstRow.classList).not.toContain("is-active");
    const select = element<HTMLSelectElement>(".rule-clause-name");
    select.dispatchEvent(new Event("change"));
    select.value = "sourceurl";
    select.dispatchEvent(new Event("change"));
    expect(textarea.value).toContain("sourceurl/i: pdf");

    const insensitive = element<HTMLInputElement>(".rule-clause-flag input");
    insensitive.checked = false;
    insensitive.dispatchEvent(new Event("change"));
    expect(textarea.value).toContain("sourceurl: pdf");

    element<HTMLButtonElement>(".rule-editor-add-condition").click();
    expect(textarea.value).toContain("sourceurl: .*");
    element<HTMLButtonElement>(
      '[data-rule-index="0"] .rule-clause-capture [data-rule-action="delete-clause"]',
    ).click();
    expect(textarea.value).not.toContain("capturegroups:");
    element<HTMLButtonElement>('[data-rule-index="1"] [data-rule-action="up"]').click();
    expect(
      element<HTMLElement>('[data-rule-index="0"] .rule-editor-meta').textContent,
    ).not.toContain("Documents");
  });

  test("renders an empty localized editor without optional actions", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = "";
    element("#rule-editor-add").remove();
    element("#rule-editor-add-auto").remove();
    const manage = element<HTMLButtonElement>("#auto-download-manage-rules");
    setupRuleVisualEditor({ matchers: [], localize: (key) => key });
    expect(element(".rule-editor-empty").textContent).toBe("routeVisualEmpty");

    manage.click();
    const navigateTarget = vi.fn();
    document.addEventListener("save-in:navigate-option", navigateTarget, { once: true });
    manage.click();
    expect((navigateTarget.mock.calls[0]![0] as CustomEvent).detail.target).toBe(
      element("#rules-mode-visual"),
    );
    element<HTMLButtonElement>("#rules-mode-text").dispatchEvent(
      new KeyboardEvent("keydown", { key: "x", bubbles: true }),
    );
    element<HTMLButtonElement>("#rules-mode-text").dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    element<HTMLButtonElement>("#rules-mode-visual").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
  });

  test("supports matcher-only rules and a fallback condition name", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = "filename: jpg";
    setupRuleVisualEditor({ matchers: [] });
    element<HTMLButtonElement>(".rule-editor-add-condition").click();
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe(
      "filename: jpg\nfilename: .*",
    );
  });

  test("debounces external text edits only while Visual mode is active", () => {
    vi.useFakeTimers();
    setupRuleVisualEditor({ matchers: ["filename"] });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    textarea.value = "filename: png\ninto: png";
    textarea.dispatchEvent(new InputEvent("input"));
    textarea.value = "filename: gif\ninto: gif";
    textarea.dispatchEvent(new InputEvent("input"));
    vi.advanceTimersByTime(180);
    expect(element<HTMLInputElement>(".rule-clause-value").value).toBe("gif");

    element<HTMLButtonElement>("#rules-mode-text").click();
    textarea.value = "filename: webp\ninto: webp";
    textarea.dispatchEvent(new InputEvent("input"));
    vi.advanceTimersByTime(180);
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(true);
  });

  test("contains unavailable local storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setupRuleVisualEditor({ matchers: ["filename"] })).not.toThrow();
  });

  test("ignores irrelevant debugger selections and highlights matching clauses", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    document.dispatchEvent(new Event("route-debugger-source-selected"));
    document.dispatchEvent(new CustomEvent("route-debugger-source-selected"));
    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", { detail: { ruleIndex: 99, line: 1 } }),
    );
    element<HTMLButtonElement>("#rules-mode-text").click();
    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", { detail: { ruleIndex: 0, line: 1 } }),
    );
    element<HTMLButtonElement>("#rules-mode-visual").click();
    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", { detail: { ruleIndex: 0 } }),
    );
    document.dispatchEvent(
      new CustomEvent("route-debugger-source-selected", { detail: { ruleIndex: 0, line: 99 } }),
    );
    expect(element(".rule-editor-card").classList).toContain("is-debug-selected");
  });

  test.each([{ body: {} }, { body: { matchers: [] } }])(
    "keeps default matchers for runtime response %#",
    async (response) => {
      vi.mocked(browser.runtime.sendMessage).mockResolvedValueOnce(response as never);
      setupRuleVisualEditor();
      await Promise.resolve();
      expect(document.querySelectorAll(".rule-clause-name option").length).toBeGreaterThan(1);
    },
  );

  test("loads runtime matchers and contains lookup failures", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { matchers: ["sourcekind"] } } as never)
      .mockRejectedValueOnce(new Error("offline"));
    setupRuleVisualEditor();
    await vi.waitFor(() =>
      expect(element<HTMLSelectElement>(".rule-clause-name").options).toHaveLength(2),
    );

    const restoredMarkup = document.body.innerHTML;
    document.body.innerHTML = restoredMarkup;
    setupRuleVisualEditor();
    await Promise.resolve();
  });

  test("does not rebuild a Text-mode editor after runtime matcher loading", async () => {
    localStorage.setItem("saveInRulesEditorMode", "text");
    let resolve!: (value: unknown) => void;
    vi.mocked(browser.runtime.sendMessage).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }) as never,
    );
    setupRuleVisualEditor();
    resolve({ body: { matchers: ["sourcekind"] } });
    await Promise.resolve();
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(true);
  });

  test("returns before wiring an incomplete editor", () => {
    document.body.innerHTML = '<textarea id="filenamePatterns"></textarea>';
    expect(() => setupRuleVisualEditor({ matchers: [] })).not.toThrow();
  });
});
