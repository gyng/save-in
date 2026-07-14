// @vitest-environment jsdom
import {
  createSyntaxEditor,
  renderSyntaxHighlight,
  setSyntaxEditorDiagnostics,
  setupSyntaxEditors,
} from "../src/options/syntax-editor.ts";

describe("syntax editor surface", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("mirrors edits in the highlighted source overlay", () => {
    document.body.innerHTML = '<label>Rules<textarea id="rules"></textarea></label>';
    const label = document.querySelector("label")!;
    const textarea = document.querySelector("textarea")!;
    textarea.value = "filename/i: \\.png$\ninto: images/:date:";
    const editor = createSyntaxEditor(textarea, "routing");

    expect(textarea.getAttribute("wrap")).toBe("off");
    const overlay = label.querySelector<HTMLElement>('pre[aria-hidden="true"]')!;
    expect(overlay.textContent).toContain(textarea.value);

    textarea.value += "\nbroken";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const diagnostic = overlay.querySelector<HTMLElement>("[data-diagnostic]")!;
    expect(diagnostic.textContent).toBe("broken");
    expect(diagnostic.dataset.diagnostic).toContain("L3:");

    setSyntaxEditorDiagnostics(textarea, [
      {
        start: textarea.value.length - "broken".length,
        end: textarea.value.length,
        line: 3,
        column: 0,
        message: "Invalid clause: broken",
        severity: "error",
      },
    ]);
    expect(document.querySelector('[data-diagnostic="L3: Invalid clause: broken"]')).not.toBeNull();

    editor.destroy();
    expect(label.querySelector("pre")).toBeNull();
    expect(textarea.parentElement).toBe(label);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  test("renders read-only routing highlights without editor chrome", () => {
    const source = "filename/i: \\.png$\ninto: images/:date:";
    const target = document.createElement("pre");

    renderSyntaxHighlight(target, "routing", source);

    expect(target.textContent).toBe(source);
    expect(target.querySelector(".syntax-token-matcher")?.textContent).toBe("filename");
    expect(target.querySelector(".syntax-token-variable")?.textContent).toBe(":date:");
    expect(target.querySelector(".syntax-editor-end-marker")).toBeNull();
  });

  test("refreshes highlighting after stored options are restored", () => {
    document.body.innerHTML = '<textarea id="filter"></textarea>';
    const textarea = document.querySelector("textarea")!;
    createSyntaxEditor(textarea, "match-patterns");

    textarea.value = "https://example.com/*";
    document.dispatchEvent(new Event("options-restored"));

    expect(document.querySelector(".syntax-editor-overlay")?.textContent).toContain(textarea.value);
    expect(document.querySelector(".syntax-token-matcher")?.textContent).toBe("https");
  });

  test("renders diagnostics, caret feedback, and gutter navigation without hover tooltips", () => {
    document.body.innerHTML = '<textarea id="paths">first\nsecond</textarea>';
    const textarea = document.querySelector("textarea")!;
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: 6,
        end: 12,
        line: 2,
        column: 0,
        message: "Bad destination",
        severity: "warning",
      },
    ]);

    const overlay = document.querySelector<HTMLElement>('pre[aria-hidden="true"]')!;
    const diagnostic = overlay.querySelector<HTMLElement>(
      '[data-diagnostic="L2: Bad destination"]',
    )!;
    expect(diagnostic.textContent).toBe("second");
    expect(diagnostic.dataset.diagnostic).toBe("L2: Bad destination");
    expect(
      document.querySelector<HTMLElement>('[data-start="6"][data-diagnostic="L2: Bad destination"]')
        ?.textContent,
    ).toBe("2");

    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 2, clientY: 25 }));
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.hidden).toBe(true);

    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new MouseEvent("click"));
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("Bad destination");
    textarea.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.hidden).toBe(false);
    textarea.dispatchEvent(new FocusEvent("blur"));
    expect(tooltip.hidden).toBe(true);

    textarea.value = "first\nfixed";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(overlay.querySelector('[data-diagnostic="L2: Bad destination"]')).toBeNull();
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: textarea.value.length,
        end: textarea.value.length,
        line: 2,
        column: 5,
        message: "Value required",
        severity: "error",
      },
    ]);
    expect(overlay.querySelector('[data-diagnostic="L2: Value required"]')?.textContent).toBe("d");

    document
      .querySelector<HTMLElement>('div[aria-hidden="true"] [data-start="6"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(textarea.selectionStart).toBe(6);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.textContent).toContain("L2");
  });

  test("sets up all option syntax editors once and rejects a disconnected textarea", () => {
    document.body.innerHTML = [
      '<textarea id="paths">one</textarea>',
      '<textarea id="filenamePatterns">into: images</textarea>',
      '<textarea id="preferLinksFilter">example\\.com</textarea>',
      '<textarea id="browserDownloadFilter">*://example.com/*</textarea>',
      '<textarea id="browserDownloadExcludeFilter"></textarea>',
      '<textarea id="setRefererHeaderFilter">https://example.com/*</textarea>',
    ].join("");

    const editors = setupSyntaxEditors();
    expect(editors.map(({ language }) => language)).toEqual([
      "directories",
      "routing",
      "regular-expressions",
      "match-patterns",
      "match-patterns",
      "match-patterns",
    ]);
    expect(createSyntaxEditor(editors[0]!.textarea, "directories")).toBe(editors[0]);
    expect(setupSyntaxEditors()).toEqual(editors);

    editors.forEach((editor) => editor.destroy());
    document.body.innerHTML = "";
    expect(setupSyntaxEditors()).toEqual([]);

    const disconnected = document.createElement("textarea");
    expect(() => createSyntaxEditor(disconnected, "routing")).toThrow(
      "Syntax editor textarea must be connected",
    );
  });

  test("shows line-end diagnostics only while the caret intersects the error", () => {
    document.body.innerHTML = '<textarea id="paths">first\nsecond</textarea>';
    const textarea = document.querySelector("textarea")!;
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: 7,
        end: 10,
        line: 2,
        column: 1,
        message: "Bad destination",
        severity: "error",
      },
    ]);
    const inline = () => document.querySelector<HTMLElement>(".syntax-editor-inline-diagnostic");

    expect(inline()).toBeNull();

    textarea.focus();
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new Event("select"));
    expect(inline()?.textContent).toContain("Bad destination");
    expect(
      document.querySelectorAll<HTMLElement>(".syntax-editor-inline-row")[1]!.style.paddingLeft,
    ).toBe("8ch");
    expect(inline()!.style.marginLeft).toBe("");

    setSyntaxEditorDiagnostics(textarea, [
      {
        start: 7,
        end: 10,
        line: 2,
        column: 1,
        message: "Unusual destination",
        severity: "warning",
      },
    ]);
    expect(inline()?.classList.contains("syntax-editor-inline-warning")).toBe(true);

    textarea.setSelectionRange(11, 11);
    textarea.dispatchEvent(new Event("select"));
    expect(inline()).toBeNull();

    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new Event("select"));
    expect(inline()).not.toBeNull();
    textarea.blur();
    expect(inline()).toBeNull();
  });

  test("handles caret, keyboard, visibility, and scroll states", () => {
    document.body.innerHTML = '<textarea id="paths">first\n\tsecond</textarea>';
    const textarea = document.querySelector("textarea")!;
    const editor = createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      {
        start: 6,
        end: 13,
        line: 2,
        column: 0,
        message: "Bad destination",
        severity: "warning",
      },
    ]);
    vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue({
      top: 10,
      left: 10,
      right: 410,
      bottom: 210,
      width: 400,
      height: 200,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    });
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;

    textarea.setSelectionRange(0, 2);
    textarea.dispatchEvent(new MouseEvent("click"));
    expect(tooltip.hidden).toBe(true);

    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(new MouseEvent("click"));
    expect(tooltip.hidden).toBe(true);

    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 500 }));
    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 12, clientY: 12 }));
    expect(tooltip.hidden).toBe(true);

    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 12, clientY: 40 }));
    expect(tooltip.hidden).toBe(true);
    textarea.setSelectionRange(8, 8);
    textarea.dispatchEvent(new MouseEvent("click"));
    textarea.dispatchEvent(new MouseEvent("mousemove", { clientX: 12, clientY: 12 }));
    expect(tooltip.hidden).toBe(false);

    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tooltip.hidden).toBe(true);
    textarea.dispatchEvent(
      new CustomEvent("syntax-editor-visibility", { detail: { visible: true } }),
    );
    textarea.dispatchEvent(
      new CustomEvent("syntax-editor-visibility", { detail: { visible: false } }),
    );

    textarea.scrollLeft = 12;
    textarea.scrollTop = 24;
    textarea.dispatchEvent(new Event("scroll"));
    expect(document.querySelector<HTMLElement>(".syntax-editor-overlay")!.style.transform).toBe(
      "translate(-12px, -24px)",
    );
    editor.destroy();
  });

  test("deduplicates diagnostics and contains malformed gutter targets", () => {
    document.body.innerHTML = '<textarea id="paths">abc\ndef</textarea>';
    const textarea = document.querySelector("textarea")!;
    vi.mocked(global.browser.i18n.getMessage).mockReturnValue("");
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      { start: -10, end: 99, line: 1, column: 0, message: "html_required", severity: "error" },
      { start: 0, end: 3, line: 1, column: 0, message: "html_required: detail", severity: "error" },
      { start: 1, end: 2, line: 1, column: 0, message: "html_required", severity: "error" },
      { start: 0, end: 0, line: 1, column: 0, message: "At start", severity: "warning" },
      { start: 0, end: 3, line: 1, column: 0, message: "Other", severity: "warning" },
      { start: 4, end: 7, line: 2, column: 0, message: "Second", severity: "warning" },
    ]);

    const gutter = document.querySelector<HTMLElement>(".syntax-editor-gutter")!;
    const second = gutter.querySelector<HTMLElement>('[data-line="2"]')!;
    second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.textContent).toContain("Second");
    second.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(tooltip.hidden).toBe(true);

    textarea.setSelectionRange(5, 5);
    textarea.dispatchEvent(new MouseEvent("click"));
    second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(tooltip.textContent).toContain("Second");
    second.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(tooltip.hidden).toBe(false);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    setSyntaxEditorDiagnostics(textarea, []);
    const cleanSecond = gutter.querySelector<HTMLElement>('[data-start="4"]')!;
    cleanSecond.dataset.line = "2";
    cleanSecond.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')!.hidden).toBe(true);

    gutter.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    gutter.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const text = document.createTextNode("x");
    gutter.append(text);
    text.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    text.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
});
