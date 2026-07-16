// @vitest-environment jsdom

import { setupRuleVisualEditor } from "../../../src/options/rule-editor/rule-visual-editor.ts";
import { EDITOR_VALIDATION_EVENT } from "../../../src/options/syntax-editor/editor-validation.ts";

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
      <button type="button" id="browser-download-manage-rules">Open routing rules</button>
      <input id="route-debugger-filename" value="report.pdf">
      <input id="route-debugger-source-url" value="https://cdn.example/report.pdf">
      <select id="route-debugger-context"><option value="link" selected>Link</option></select>
      <section id="options-reference-clauses">
        <table><tbody>
          <tr><td><code>context:</code></td><td>page</td><td>Matches how the save started.</td></tr>
          <tr><td><code>filename:</code></td><td>file.jpg</td><td>Matches the resolved filename.</td></tr>
          <tr><td><code>sourceurl:</code></td><td>https://example/file.jpg</td><td>Matches the source URL.</td></tr>
        </tbody></table>
      </section>
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
    expect(element<HTMLElement>(".rule-editor-card h5").textContent).toBe("Rule 1");
    expect(element<HTMLInputElement>(".rule-clause-value").value).toBe("\\.jpg$");
    expect(
      [...document.querySelectorAll("#rules-visual input, #rules-visual select")].every(
        (control) => control.hasAttribute("id") || control.hasAttribute("name"),
      ),
    ).toBe(true);
  });

  test("closes the add menu before opening the template browser", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    const menu = element<HTMLDetailsElement>(".rule-add-menu");
    menu.open = true;

    element<HTMLButtonElement>("#rule-editor-browse-templates").click();

    expect(menu.open).toBe(false);
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

  test("renders a fetch clause as a dedicated rewrite-download-URL row", () => {
    vi.mocked(browser.i18n.getMessage).mockImplementation((key: string) => {
      if (key === "routeVisualFetchLabel") return "Rewrite download URL";
      if (key === "routeVisualFetchAccessible") return "Rule $RULE$: rewrite download URL";
      return "";
    });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    textarea.value =
      "filename: \\.jpg$\nfetch: https://cdn.example/full.jpg\ninto: originals/:filename:";

    setupRuleVisualEditor({ matchers: ["filename"], variables: [] });
    element<HTMLButtonElement>("#rules-mode-visual").click();

    expect(document.querySelector(".rule-editor-card-unsupported")).toBeNull();
    const fetchRow = element<HTMLElement>(".rule-clause-fetch");
    expect(fetchRow.querySelector(".rule-clause-marker")?.textContent).toBe("⇄");
    expect(fetchRow.querySelector(".rule-clause-fixed-name")?.textContent).toBe(
      "Rewrite download URL",
    );
    const value = fetchRow.querySelector<HTMLInputElement>(".rule-clause-value")!;
    expect(value.value).toBe("https://cdn.example/full.jpg");
    expect(value.name).toBe("routing-fetch");
    expect(value.getAttribute("aria-label")).toBe("Rule 1: rewrite download URL");
  });

  test("shows a selector example for a CSS matcher row", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = "css: article img\ninto: images/";
    setupRuleVisualEditor({ matchers: ["css"] });

    expect(element<HTMLInputElement>(".rule-clause-value").placeholder).toBe(
      "article img, .gallery video",
    );
    expect(document.querySelector(".rule-clause-flag")).toBeNull();
  });

  test("renders a rename clause as a dedicated rename-the-file row", () => {
    vi.mocked(browser.i18n.getMessage).mockImplementation((key: string) => {
      if (key === "routeVisualRenameLabel") return "Rename the file";
      if (key === "routeVisualRenameAccessible") return "Rule $RULE$: rename the file";
      return "";
    });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    // Visual mode supports only the /i flag, matching matcher clauses; /g
    // rules stay editable in text mode.
    textarea.value = "filename: \\.jpg$\nrename/i: cat -> dog\ninto: originals/:filename:";

    setupRuleVisualEditor({ matchers: ["filename"], variables: [] });
    element<HTMLButtonElement>("#rules-mode-visual").click();

    expect(document.querySelector(".rule-editor-card-unsupported")).toBeNull();
    const renameRow = element<HTMLElement>(".rule-clause-rename");
    expect(renameRow.querySelector(".rule-clause-marker")?.textContent).toBe("✎");
    expect(renameRow.querySelector(".rule-clause-fixed-name")?.textContent).toBe("Rename the file");
    const value = renameRow.querySelector<HTMLInputElement>(".rule-clause-value")!;
    expect(value.value).toBe("cat -> dog");
    expect(value.name).toBe("routing-rename");
    expect(value.getAttribute("aria-label")).toBe("Rule 1: rename the file");
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

    expect(element<HTMLElement>(".rule-editor-enabled-label").textContent).toBe("");
    expect(element<HTMLElement>(".rule-editor-enabled-label").querySelector("span")).toBeNull();
    expect(element<HTMLInputElement>(".rule-editor-enabled").getAttribute("aria-label")).toBe(
      "Rule 1 enabled",
    );
    expect(element<HTMLInputElement>(".rule-clause-name").getAttribute("aria-label")).toBe(
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

  test("provides sorted matcher typeahead and destination variable autocomplete", () => {
    setupRuleVisualEditor({
      matchers: ["sourceurl", "filename", "context"],
      variables: [":day:", ":date:"],
    });

    const matcher = element<HTMLInputElement>(".rule-clause-name");
    matcher.focus();
    expect(matcher.readOnly).toBe(true);
    expect(matcher.getAttribute("role")).toBe("combobox");
    const matcherDropdown = document.getElementById(matcher.getAttribute("aria-controls")!);
    expect(matcherDropdown?.style.width).toBe("360px");
    expect(matcherDropdown?.classList).toContain("typeahead-dropdown-reference");
    const matcherOptions = [
      ...(matcherDropdown?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []),
    ];
    expect(
      [...(matcherDropdown?.querySelectorAll(".typeahead-group") ?? [])].map(
        (heading) => heading.textContent,
      ),
    ).toEqual([
      "Page and menu context",
      "URL and source matching",
      "Filename and content matching",
    ]);
    expect(
      matcherOptions.map((option) => option.querySelector(".typeahead-option-label")?.textContent),
    ).toEqual(["context", "sourceurl", "filename"]);
    expect(
      matcherOptions.map(
        (option) => option.querySelector(".typeahead-option-description")?.textContent,
      ),
    ).toEqual([
      "Matches how the save started.",
      "Matches the source URL.",
      "Matches the resolved filename.",
    ]);
    expect(
      matcherOptions.map((option) => option.querySelector(".typeahead-option-meta")?.textContent),
    ).toEqual(["link", "https://cdn.example/report.pdf", "report.pdf"]);
    expect(matcher.getAttribute("aria-activedescendant")).toBe(
      matcherOptions.find((option) => option.textContent?.includes("filename"))?.id,
    );
    matcherOptions[0]!.click();
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toContain("context/i:");

    const destination = element<HTMLInputElement>(".rule-clause-destination .rule-clause-value");
    destination.value = "docs/:d";
    destination.selectionStart = destination.value.length;
    destination.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const dropdown = document.getElementById(destination.getAttribute("aria-controls")!);
    expect(
      [...(dropdown?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map(
        (option) => option.querySelector(".autocomplete-option-label")?.textContent,
      ),
    ).toEqual([":date:", ":day:"]);

    destination.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toContain("into: docs/:date:");
  });

  test("keeps a separator when completing a variable into an empty destination", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = "fileext: pdf\ninto:";
    setupRuleVisualEditor({ matchers: ["fileext"], variables: [":filename:"] });

    const destination = element<HTMLInputElement>(".rule-clause-destination .rule-clause-value");
    destination.value = ":";
    destination.setSelectionRange(1, 1);
    destination.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe("fileext: pdf\ninto: :");

    destination.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe(
      "fileext: pdf\ninto: :filename:",
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

  test("reorders rules by dragging the dedicated card handle", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = [
      "filename: jpg",
      "into: images",
      "",
      "sourceurl: cdn",
      "into: downloads",
    ].join("\n");
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });

    const cards = document.querySelectorAll<HTMLElement>(".rule-editor-card");
    const handles = document.querySelectorAll<HTMLElement>(".rule-editor-drag-handle");
    vi.spyOn(cards[1]!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);

    handles[0]!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    cards[1]!.dispatchEvent(
      new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY: 75 }),
    );
    expect(cards[1]!.classList).toContain("is-drop-after");
    cards[1]!.dispatchEvent(
      new MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 75 }),
    );

    expect(element<HTMLTextAreaElement>("#filenamePatterns").value).toBe(
      ["sourceurl: cdn", "into: downloads", "", "filename: jpg", "into: images"].join("\n"),
    );
  });

  test("contains card drag lifecycle edge cases", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value = [
      "filename: jpg",
      "into: images",
      "",
      "sourceurl: cdn",
      "into: downloads",
    ].join("\n");
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });

    let cards = document.querySelectorAll<HTMLElement>(".rule-editor-card");
    let handles = document.querySelectorAll<HTMLElement>(".rule-editor-drag-handle");
    const transfer = { effectAllowed: "none", dropEffect: "none", setData: vi.fn() };
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: transfer });
    handles[1]!.dispatchEvent(start);
    expect(transfer.effectAllowed).toBe("move");
    expect(transfer.setData).toHaveBeenCalledWith("text/plain", "1");

    vi.spyOn(cards[0]!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    const over = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY: 25 });
    Object.defineProperty(over, "dataTransfer", { value: transfer });
    cards[0]!.dispatchEvent(over);
    expect(transfer.dropEffect).toBe("move");
    expect(cards[0]!.classList).toContain("is-drop-before");

    cards[0]!.dispatchEvent(
      new MouseEvent("dragleave", { bubbles: true, relatedTarget: cards[0]!.firstChild }),
    );
    expect(cards[0]!.classList).toContain("is-drop-before");
    cards[0]!.dispatchEvent(new MouseEvent("dragleave", { bubbles: true }));
    expect(cards[0]!.classList).not.toContain("is-drop-before");

    cards[0]!.dispatchEvent(
      new MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 25 }),
    );
    expect(element<HTMLTextAreaElement>("#filenamePatterns").value.startsWith("sourceurl")).toBe(
      true,
    );

    cards = document.querySelectorAll<HTMLElement>(".rule-editor-card");
    handles = document.querySelectorAll<HTMLElement>(".rule-editor-drag-handle");
    handles[0]!.dispatchEvent(new Event("dragstart", { bubbles: true }));
    vi.spyOn(cards[1]!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    cards[1]!.dispatchEvent(
      new MouseEvent("drop", { bubbles: true, cancelable: true, clientY: 25 }),
    );
    handles[0]!.dispatchEvent(new Event("dragend", { bubbles: true }));

    cards[0]!.dispatchEvent(new MouseEvent("dragover", { bubbles: true, cancelable: true }));
    cards[0]!.dispatchEvent(new MouseEvent("drop", { bubbles: true, cancelable: true }));
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

  test("opens the shared editor from Browser routings without changing its mode", () => {
    localStorage.setItem("saveInRulesEditorMode", "text");
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupRuleVisualEditor({ matchers: ["context", "sourceurl"] });

    element<HTMLButtonElement>("#browser-download-manage-rules").click();

    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
    expect(navigate).toHaveBeenCalledOnce();
    expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(
      element("#filenamePatterns"),
    );
  });

  test("navigates Browser routings to the active visual editor", () => {
    localStorage.setItem("saveInRulesEditorMode", "visual");
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupRuleVisualEditor({ matchers: ["context", "sourceurl"] });

    element<HTMLButtonElement>("#browser-download-manage-rules").click();

    expect((navigate.mock.calls[0]![0] as CustomEvent).detail.target).toBe(
      element("#rules-mode-visual"),
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

  test("a stale Edit-in-Text click still opens Text mode without selecting", () => {
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    textarea.value = "filename: jpg\nnot a clause\ninto: images/:filename:";
    setupRuleVisualEditor({ matchers: ["filename"] });
    element<HTMLButtonElement>("#rules-mode-visual").click();
    const edit = element<HTMLButtonElement>(".rule-editor-edit-text");

    // The textarea can change underneath a rendered card (e.g. an import
    // replacing the source before the rebuild event lands). A stale click
    // must still reach Text mode for manual repair instead of throwing or
    // selecting a line that no longer exists.
    textarea.value = "filename: jpg";
    expect(() => edit.click()).not.toThrow();

    expect(element<HTMLElement>("#rules-text-editor").hidden).toBe(false);
    expect(element<HTMLElement>("#rules-visual").hidden).toBe(true);
    expect(document.activeElement).toBe(textarea);
    // No range is selected; the stale line number is dropped, not clamped.
    expect(textarea.selectionStart).toBe(textarea.selectionEnd);
  });

  test("uses the rule line for read-only rules with unsupported flags", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value =
      "filename/x: jpg\ninto: images/:filename:";
    setupRuleVisualEditor({ matchers: ["filename"] });

    expect(element<HTMLElement>(".rule-editor-unsupported").textContent).toContain("line 1");
  });

  test("contains optional add actions outside their normal menu wrapper", () => {
    const menu = element<HTMLDetailsElement>(".rule-add-menu");
    const addAutomatic = element<HTMLButtonElement>("#rule-editor-add-auto");
    const browse = element<HTMLButtonElement>("#rule-editor-browse-templates");
    menu.replaceWith(addAutomatic, browse);
    setupRuleVisualEditor({ matchers: ["filename"] });

    addAutomatic.click();
    browse.click();
    element<HTMLButtonElement>("#auto-download-manage-rules").click();

    expect(document.querySelectorAll(".rule-editor-card")).toHaveLength(2);
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
      selectedCard.querySelector<HTMLInputElement>(".rule-clause-name"),
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
    expect(element<HTMLInputElement>(".rule-editor-name").value).toBe("Documents");
    expect(
      [...document.querySelectorAll(".rule-clause-marker")].map((node) => node.textContent),
    ).toContain("$");

    const firstRow = element<HTMLElement>(".rule-clause-row");
    firstRow.click();
    expect(firstRow.classList).toContain("is-active");
    const secondRow = document.querySelectorAll<HTMLElement>(".rule-clause-row")[1]!;
    secondRow.click();
    expect(firstRow.classList).not.toContain("is-active");
    const matcher = element<HTMLInputElement>(".rule-clause-name");
    matcher.dispatchEvent(new Event("change"));
    matcher.value = "sourceurl";
    matcher.dispatchEvent(new Event("change"));
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
    expect(element<HTMLInputElement>('[data-rule-index="0"] .rule-editor-name').value).not.toBe(
      "Documents",
    );
  });

  test("renames and clears a rule from its card header", () => {
    setupRuleVisualEditor({ matchers: ["filename"] });
    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    let name = element<HTMLInputElement>(".rule-editor-name");

    expect(name.value).toBe("");
    expect(name.placeholder).toBe("Rule name");
    name.dispatchEvent(new Event("change"));
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    name.value = "Discard me";
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(name.value).toBe("");
    name.value = "JPEG files";
    name.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    name.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe("// JPEG files\nfilename/i: \\.jpg$\ninto: images/:filename:");

    name = element<HTMLInputElement>(".rule-editor-name");
    expect(name.value).toBe("JPEG files");
    name.value = "";
    name.dispatchEvent(new Event("change"));
    expect(textarea.value).toBe("filename/i: \\.jpg$\ninto: images/:filename:");
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
      const matcher = element<HTMLInputElement>(".rule-clause-name");
      matcher.focus();
      expect(
        document
          .getElementById(matcher.getAttribute("aria-controls")!)
          ?.querySelectorAll('[role="option"]').length,
      ).toBeGreaterThan(1);
    },
  );

  test("loads runtime matchers and contains lookup failures", async () => {
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { matchers: ["sourcekind"], variables: [":date:"] } } as never)
      .mockRejectedValueOnce(new Error("offline"));
    setupRuleVisualEditor();
    await vi.waitFor(() => {
      const matcher = element<HTMLInputElement>(".rule-clause-name");
      matcher.focus();
      expect(
        document
          .getElementById(matcher.getAttribute("aria-controls")!)
          ?.querySelectorAll('[role="option"]'),
      ).toHaveLength(2);
    });

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

  test("cards report option-aware reachability for automatic rules", () => {
    element<HTMLTextAreaElement>("#filenamePatterns").value =
      "context: ^auto$\npageurl: ^https://example\\.test/\nsourcekind: ^stream$\ninto: streams/";
    setupRuleVisualEditor({ matchers: ["filename", "sourcekind"] });

    // No discovery checkboxes exist in this fixture, so the master switch is
    // off and no channel produces stream candidates.
    const notes = element<HTMLElement>(".rule-editor-reachability");
    const kinds = [...notes.querySelectorAll("[data-reachability]")].map(
      (note) => (note as HTMLElement).dataset.reachability,
    );
    expect(kinds).toEqual(["automatic-saves-off", "unreachable-kinds"]);
    expect(
      notes.querySelector<HTMLElement>('[data-reachability="automatic-saves-off"]')?.dataset.level,
    ).toBe("info");
    expect(
      notes.querySelector<HTMLElement>('[data-reachability="unreachable-kinds"]')?.dataset.level,
    ).toBe("warning");
  });

  test("reachability notes follow the discovery checkboxes live", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<input type="checkbox" id="autoDownloadEnabled" checked>
       <input type="checkbox" id="autoDownloadDocuments" checked>`,
    );
    element<HTMLTextAreaElement>("#filenamePatterns").value =
      "context: ^auto$\npageurl: ^https://example\\.test/\nsourcekind: ^stream$\ninto: streams/";
    setupRuleVisualEditor({ matchers: ["filename", "sourcekind"] });

    expect(document.querySelector(".rule-editor-reachability")).toBeNull();

    const documents = element<HTMLInputElement>("#autoDownloadDocuments");
    documents.checked = false;
    documents.dispatchEvent(new Event("change"));

    expect(
      document.querySelector<HTMLElement>('[data-reachability="unreachable-kinds"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-reachability="automatic-saves-off"]')).toBeNull();

    // A toggle while Text mode is active must not rebuild the hidden cards.
    element<HTMLButtonElement>("#rules-mode-text").click();
    const cardCount = element<HTMLElement>("#rule-editor-cards").children.length;
    documents.checked = true;
    documents.dispatchEvent(new Event("change"));
    expect(element<HTMLElement>("#rule-editor-cards").children.length).toBe(cardCount);
  });

  test("each reachability sentence renders for its rule shape", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<input type="checkbox" id="autoDownloadEnabled" checked>',
    );
    element<HTMLTextAreaElement>("#filenamePatterns").value = [
      "context: ^auto$\npageurl: .\nsourcekind: ^link$\ninto: links/",
      "context: ^auto$\npageurl: .\nsourcekind: ^pdf$\ninto: broken/",
      "context: ^auto$\npageurl: .\nsourcekind: ^document$\ninto: :menupath:/docs/",
    ].join("\n\n");
    setupRuleVisualEditor({ matchers: ["sourcekind"] });

    const kinds = [...document.querySelectorAll("[data-reachability]")].map(
      (note) => (note as HTMLElement).dataset.reachability,
    );
    expect(kinds).toEqual(["link-only", "no-kinds", "unreachable-kinds", "menupath-empty"]);
  });

  test("ordinary rules never render reachability notes", () => {
    setupRuleVisualEditor({ matchers: ["filename", "sourceurl"] });

    expect(element<HTMLElement>("#rule-editor-cards").children.length).toBeGreaterThan(0);
    expect(document.querySelector(".rule-editor-reachability")).toBeNull();
  });
});
