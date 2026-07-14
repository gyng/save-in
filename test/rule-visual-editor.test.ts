// @vitest-environment jsdom

import { setupRuleVisualEditor } from "../src/options/rule-visual-editor.ts";

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
        <button type="button" id="rule-editor-add-auto">Add automatic source rule</button>
      </div>
      <button type="button" id="auto-download-manage-rules">Open routing rules</button>
    `;
  });

  afterEach(() => {
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

  test("creates and identifies a guarded automatic-source rule", () => {
    setupRuleVisualEditor({ matchers: ["context", "pageurl", "sourcekind"] });
    element<HTMLButtonElement>("#rule-editor-add-auto").click();

    const source = element<HTMLTextAreaElement>("#filenamePatterns").value;
    expect(source).toContain("context: ^auto$");
    expect(source).toContain("pageurl: ^https://example\\.com/");
    expect(source).toContain("sourcekind: ^image$");
    expect(source).toContain("disabled: true");
    expect(document.querySelectorAll(".rule-editor-auto-badge")).toHaveLength(1);
  });

  test("opens the shared editor in Visual mode from Page Sources", () => {
    localStorage.setItem("saveInRulesEditorMode", "text");
    const navigate = vi.fn();
    document.addEventListener("save-in:navigate-option", navigate, { once: true });
    setupRuleVisualEditor({ matchers: ["context", "pageurl", "sourcekind"] });

    element<HTMLButtonElement>("#auto-download-manage-rules").click();

    expect(element<HTMLElement>("#rules-visual").hidden).toBe(false);
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
    expect(document.querySelectorAll(".rule-editor-card.is-debug-selected")).toHaveLength(1);
  });
});
