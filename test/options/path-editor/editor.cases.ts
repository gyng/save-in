// Cases imported by ui.test.ts to share one jsdom environment.
// Paths insert menu + visual directory editor: pure line helpers must
// round-trip the textarea syntax losslessly, and the visual editor must
// serialize every edit back to the textarea (the source of truth).

import { PathEditor, setupPathEditor } from "../../../src/options/path-editor/path-editor.ts";
import {
  createSyntaxEditor,
  setSyntaxEditorDiagnostics,
} from "../../../src/options/syntax-editor/syntax-editor.ts";
import {
  dispatchEditorValidation,
  EDITOR_VALIDATION_EVENT,
  markValidationField,
} from "../../../src/options/syntax-editor/editor-validation.ts";

const element = <T extends Element>(selector: string): T => {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing test element: ${selector}`);
  return match;
};

describe("line helpers", () => {
  test("parseLine builds directory AST nodes", () => {
    const parsed = PathEditor.parseLine(">>i/cats // cute (alias: Cats)");
    expect(parsed).toEqual(
      expect.objectContaining({
        kind: "directory-line",
        depth: 2,
        path: expect.objectContaining({ value: "i/cats" }),
        comment: expect.objectContaining({ value: "cute (alias: Cats)" }),
      }),
    );
    expect(PathEditor.parseLine("images").path.value).toBe("images");
    expect(PathEditor.parseLine("---").path.value).toBe("---");
    expect(PathEditor.parseLine(">---").depth).toBe(1);
  });

  test("serializeLine round-trips parseLine", () => {
    const lines = ["images", ">>i/cats // cute (alias: Cats)", "---", ">---", "docs/:year:"];
    lines.forEach((line) => {
      expect(PathEditor.serializeLine(PathEditor.parseLine(line))).toBe(line);
    });
  });

  test("linesToNodes drops blank lines", () => {
    const nodes = PathEditor.linesToNodes("a\n\n  \n>b\n");
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toEqual(
      expect.objectContaining({ depth: 1, path: expect.objectContaining({ value: "b" }) }),
    );
  });

  test("getAlias and setAlias edit only the alias meta", () => {
    const cats = PathEditor.parseLine("path // cute (alias: Cats) (key: c)");
    expect(PathEditor.getAlias(cats)).toBe("Cats");
    expect(PathEditor.getAlias(PathEditor.parseLine("path // no alias here"))).toBe("");

    expect(PathEditor.serializeLine(PathEditor.setAlias(cats, "Dogs"))).toBe(
      "path // cute (key: c) (alias: Dogs)",
    );
    expect(
      PathEditor.serializeLine(PathEditor.setAlias(PathEditor.parseLine("path"), "Dogs")),
    ).toBe("path // (alias: Dogs)");
    expect(PathEditor.serializeLine(PathEditor.setAlias(cats, ""))).toBe("path // cute (key: c)");
  });

  test("getAccessKey and setAccessKey edit only the key metadata", () => {
    const cats = PathEditor.parseLine("path // cute (alias: Cats) (key: c)");

    expect(PathEditor.getAccessKey(cats)).toBe("c");
    expect(PathEditor.serializeLine(PathEditor.setAccessKey(cats, "d"))).toBe(
      "path // cute (alias: Cats) (key: d)",
    );
    expect(PathEditor.serializeLine(PathEditor.setAccessKey(cats, ""))).toBe(
      "path // cute (alias: Cats)",
    );
  });
});

describe("insertAtCursor / insertLine", () => {
  let textarea: HTMLTextAreaElement;
  let inputs: number;

  beforeEach(() => {
    textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    inputs = 0;
    textarea.addEventListener("input", () => {
      inputs += 1;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("insertAtCursor replaces the selection and fires input", () => {
    textarea.value = "docs/xxx/file";
    textarea.setSelectionRange(5, 8);

    PathEditor.insertAtCursor(textarea, ":year:");

    expect(textarea.value).toBe("docs/:year:/file");
    expect(textarea.selectionStart).toBe(11);
    expect(inputs).toBe(1);
  });

  test("insertAtCursor falls back when a text field has no selection", () => {
    textarea.value = "abc";
    Object.defineProperty(textarea, "selectionStart", { configurable: true, get: () => null });
    Object.defineProperty(textarea, "selectionEnd", { configurable: true, get: () => null });

    PathEditor.insertAtCursor(textarea, "x");

    expect(textarea.value).toBe("abcx");
    expect(inputs).toBe(1);
  });

  test("insertLine adds a whole line after the cursor's line", () => {
    textarea.value = "a\nb";
    textarea.setSelectionRange(0, 0); // cursor on line "a"

    PathEditor.insertLine(textarea, "---");

    expect(textarea.value).toBe("a\n---\nb");
    expect(inputs).toBe(1);
  });

  test("insertLine on an empty textarea just sets the line", () => {
    PathEditor.insertLine(textarea, "---");
    expect(textarea.value).toBe("---");
  });

  test("uses the browser undo command when insertText succeeds", () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    textarea.value = "abc";

    PathEditor.insertText(textarea, "x", 1, 2);

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "x");
    expect(inputs).toBe(0);
    Reflect.deleteProperty(document, "execCommand");
  });

  test("falls back safely when a modal keeps focus outside the target field", () => {
    const dialogControl = document.createElement("input");
    document.body.append(dialogControl);
    dialogControl.focus();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    vi.spyOn(textarea, "focus").mockImplementation(() => {});
    textarea.value = "abc";

    PathEditor.insertText(textarea, "x", 1, 2);

    expect(execCommand).not.toHaveBeenCalled();
    expect(textarea.value).toBe("axc");
    expect(inputs).toBe(1);
    Reflect.deleteProperty(document, "execCommand");
  });
});

describe("visual editor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths">a\n>b // (alias: B)\n---</textarea>
      <input type="checkbox" id="enableNumberedItems" checked>
      <button type="button" id="path-editor-add-dir"></button>
      <button type="button" id="path-editor-add-sep"></button>
      <div id="path-editor-rows"></div>
      <div id="menu-preview-tree">
        <div data-source-index="0"></div>
        <div data-source-index="1"></div>
        <div data-source-index="2"></div>
      </div>
    `;
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ body: { items: [], errors: [] } }),
    );
    vi.mocked(browser.i18n.getMessage).mockImplementation((key) => {
      if (key === "o_lPathEditorDragHelp") return "Localized drag guidance";
      return "";
    });
    new PathEditor().setupVisualEditor();
    document.dispatchEvent(new Event("options-restored"));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const textarea = () => element<HTMLTextAreaElement>("#paths");
  const rows = () => document.querySelectorAll<HTMLElement>(".path-editor-row");
  const controls = (row: number, title: string) =>
    rows()[row]!.querySelector<HTMLElement>(`[data-path-action="${title}"]`)!;

  test("renders one row per line, separators included", () => {
    expect(rows()).toHaveLength(3);
    expect(rows()[0]!.querySelector<HTMLInputElement>(".path-editor-dir")!.value).toBe("a");
    expect(rows()[1]!.querySelector<HTMLInputElement>(".path-editor-alias")!.value).toBe("B");
    expect(
      [...document.querySelectorAll("#path-editor-rows input")].every(
        (control) => control.hasAttribute("id") || control.hasAttribute("name"),
      ),
    ).toBe(true);
    expect(rows()[2]!.querySelector(".path-editor-separator")).not.toBeNull();
    expect(rows()[2]!.querySelector(".path-editor-access-key")).toBeNull();
  });

  test("uses a compact menu for secondary row actions", () => {
    const menu = rows()[1]!.querySelector<HTMLDetailsElement>(".path-editor-more")!;
    expect(menu.querySelector("summary")?.getAttribute("aria-label")).toContain("B");
    expect(
      [...menu.querySelectorAll<HTMLButtonElement>("[data-path-action]")].map(
        (button) => button.textContent,
      ),
    ).toEqual(["Always ask where to save", "Outdent", "Indent", "Move up", "Move down", "Delete"]);

    menu.open = true;
    menu.querySelector<HTMLElement>("button")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(menu.querySelector("summary"));

    menu.open = true;
    menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(menu.open).toBe(true);
    document.body.click();
    expect(menu.open).toBe(false);

    menu.querySelector<HTMLButtonElement>('[data-path-action="save as"]')!.click();
    expect(textarea().value).toContain("(dialog: true)");
  });

  test("places undo beside visual save actions when they are available", () => {
    document.body.innerHTML = `
      <textarea id="paths">a</textarea>
      <input type="checkbox" id="enableNumberedItems">
      <button id="path-editor-add-dir"></button><button id="path-editor-add-sep"></button>
      <div id="paths-visual">
        <div id="path-editor-rows"></div>
        <div class="editor-save-actions"><button data-discard="paths"></button></div>
      </div>`;
    new PathEditor().setupVisualEditor();
    const discard = element<HTMLElement>('[data-discard="paths"]');
    expect(discard.previousElementSibling).toBe(element(".path-editor-undo"));

    document.body.innerHTML = `
      <textarea id="paths">a</textarea>
      <input type="checkbox" id="enableNumberedItems">
      <button id="path-editor-add-dir"></button><button id="path-editor-add-sep"></button>
      <div id="paths-visual">
        <div id="path-editor-rows"></div><div class="editor-save-actions"></div>
      </div>`;
    new PathEditor().setupVisualEditor();
    expect(element(".editor-save-actions").firstElementChild).toBe(element(".path-editor-undo"));
  });

  test("ignores a stale row action after an external edit removes its node", () => {
    const stale = rows()[1]!.querySelector<HTMLButtonElement>("[data-path-action]")!;
    textarea().value = "";
    textarea().dispatchEvent(new Event("input"));
    vi.runAllTimers();

    expect(() => stale.click()).not.toThrow();
  });

  test("edits access-key metadata from a compact visual control", () => {
    const key = rows()[0]!.querySelector<HTMLInputElement>(".path-editor-access-key-input")!;
    expect(key.value).toBe("");
    expect(key.getAttribute("aria-label")).toBe("Assign an access key: a");

    key.value = "a";
    key.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(textarea().value).toBe("a // (key: a)\n>b // (alias: B)\n---");

    key.value = "";
    key.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("shows automatic number keys without changing path rules", () => {
    const keys = document.querySelectorAll<HTMLInputElement>(".path-editor-access-key-input");
    expect([...keys].map((key) => key.placeholder)).toEqual(["1", "1"]);
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");

    const numberedItems = element<HTMLInputElement>("#enableNumberedItems");
    numberedItems.checked = false;
    numberedItems.dispatchEvent(new Event("change"));

    expect(
      [...document.querySelectorAll<HTMLInputElement>(".path-editor-access-key-input")].map(
        (key) => key.placeholder,
      ),
    ).toEqual(["", ""]);
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("suppresses an automatic key for an explicit empty override", () => {
    textarea().value = "a // (key: )";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(element<HTMLInputElement>(".path-editor-access-key-input").placeholder).toBe("");
  });

  test("leaves the tenth automatic access key empty", () => {
    textarea().value = Array.from({ length: 10 }, (_, index) => `folder-${index + 1}`).join("\n");
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);

    const keys = document.querySelectorAll<HTMLInputElement>(".path-editor-access-key-input");
    expect(keys).toHaveLength(10);
    expect(keys[9]!.placeholder).toBe("");
  });

  test("marks, replaces, and clears visual path validation", () => {
    rows()[2]!.classList.add("has-validation-warning");
    rows()[1]!.querySelector(".path-editor-dir")?.setAttribute("aria-describedby", "path-help");
    dispatchEditorValidation(textarea(), [
      {
        sourceIndex: 1,
        message: "Path variable is not supported",
        error: ":modnthname:",
      },
    ]);

    expect(rows()[1]!.classList).toContain("has-validation-error");
    expect(rows()[2]!.classList).not.toContain("has-validation-warning");
    expect(rows()[1]!.title).toContain(":modnthname:");
    expect(rows()[1]!.querySelector(".path-editor-dir")?.getAttribute("aria-invalid")).toBe("true");
    expect(rows()[1]!.querySelector(".path-editor-dir")?.getAttribute("aria-describedby")).toBe(
      "path-help error-paths",
    );

    textarea().dispatchEvent(
      new CustomEvent(EDITOR_VALIDATION_EVENT, {
        detail: {
          errors: [
            null,
            { message: 4, error: "ignored" },
            { message: "ignored", error: 4 },
            { message: "Missing index", error: "" },
            { sourceIndex: 99, message: "Missing row", error: "unknown" },
            { sourceIndex: 0, message: "Warning only", error: "", warning: true },
          ],
        },
      }),
    );

    expect(rows()[1]!.classList).not.toContain("has-validation-error");
    expect(rows()[1]!.hasAttribute("title")).toBe(false);
    expect(rows()[1]!.querySelector(".path-editor-dir")?.hasAttribute("aria-invalid")).toBe(false);
    expect(rows()[1]!.querySelector(".path-editor-dir")?.getAttribute("aria-describedby")).toBe(
      "path-help",
    );
    expect(rows()[0]!.classList).toContain("has-validation-warning");
    expect(rows()[0]!.title).toBe("Warning only");
    expect(rows()[0]!.querySelector(".path-editor-dir")?.hasAttribute("aria-invalid")).toBe(false);

    textarea().dispatchEvent(
      new CustomEvent(EDITOR_VALIDATION_EVENT, { detail: { errors: "invalid" } }),
    );
    expect(rows()[0]!.classList).not.toContain("has-validation-warning");
    expect(rows()[0]!.hasAttribute("title")).toBe(false);

    textarea().dispatchEvent(new Event(EDITOR_VALIDATION_EVENT));
    expect(() => markValidationField(null, "error-paths")).not.toThrow();
  });

  test("toggles a row with disabled metadata", () => {
    const enabled = rows()[0]!.querySelector<HTMLInputElement>(".path-editor-enabled")!;
    expect(enabled.checked).toBe(true);
    expect(rows()[0]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!.hidden).toBe(
      false,
    );

    enabled.click();
    expect(textarea().value).toBe("a // (disabled: true)\n>b // (alias: B)\n---");
    expect(rows()[0]!.classList).toContain("is-disabled");
    expect(rows()[0]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!.hidden).toBe(
      false,
    );

    const aliasToggle = rows()[0]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!;
    aliasToggle.click();
    expect(rows()[0]!.querySelector(".path-editor-alias")?.classList).toContain("is-open");

    rows()[0]!.querySelector<HTMLInputElement>(".path-editor-enabled")!.click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
    expect(rows()[0]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!.hidden).toBe(
      false,
    );
  });

  test("keeps an existing alias visible when its row is disabled", () => {
    rows()[1]!.querySelector<HTMLInputElement>(".path-editor-enabled")!.click();

    const alias = rows()[1]!.querySelector<HTMLInputElement>(".path-editor-alias")!;
    const toggle = rows()[1]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!;
    expect(alias.value).toBe("B");
    expect(alias.classList).toContain("is-open");
    expect(toggle.hidden).toBe(false);
  });

  test("notifies preview consumers when a row is selected", () => {
    const selected = vi.fn();
    textarea().addEventListener("path-editor-row-selected", selected);

    rows()[1]!.click();

    expect(selected).toHaveBeenCalledOnce();
    expect((selected.mock.calls[0]![0] as CustomEvent).detail).toEqual({ sourceIndex: 1 });
    expect(rows()[1]!.classList).toContain("is-preview-selected");
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    const preview = document.querySelector<HTMLElement>(
      '#menu-preview-tree [data-source-index="1"]',
    )!;
    expect(preview.classList).toContain("is-source-selected");
    expect(preview.getAttribute("aria-current")).toBe("true");
  });

  test("indent and outdent rewrite the textarea", () => {
    expect((controls(0, "indent") as HTMLButtonElement).disabled).toBe(true);
    controls(1, "outdent").click();
    expect(textarea().value).toBe("a\nb // (alias: B)\n---");

    vi.advanceTimersByTime(500); // rebuild debounce
    controls(1, "indent").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("deleting a row removes its line", () => {
    controls(2, "delete").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)");
    element<HTMLButtonElement>(".path-editor-undo").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("editing the alias field updates only the alias meta", () => {
    const alias = rows()[1]!.querySelector<HTMLInputElement>(".path-editor-alias")!;
    const toggle = rows()[1]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(alias);
    alias.value = "Better";
    alias.dispatchEvent(new Event("input", { bubbles: true }));
    expect(textarea().value).toBe("a\n>b // (alias: Better)\n---");
  });

  test("keeps an empty alias collapsed until its compact toggle is used", () => {
    const alias = rows()[0]!.querySelector<HTMLInputElement>(".path-editor-alias")!;
    const toggle = rows()[0]!.querySelector<HTMLButtonElement>(".path-editor-alias-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(alias.tabIndex).toBe(-1);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(alias.tabIndex).toBe(0);
  });

  test("toolbar buttons append rows", () => {
    element<HTMLElement>("#path-editor-add-dir").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---\nnew-folder");

    vi.advanceTimersByTime(500);
    element<HTMLElement>("#path-editor-add-sep").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---\nnew-folder\n---");
  });

  test("new directories are focused with their placeholder selected", () => {
    element<HTMLElement>("#path-editor-add-dir").click();
    const input = rows()[3]!.querySelector<HTMLInputElement>(".path-editor-dir")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("new-folder".length);
  });

  test("row actions expose names and support keyboard reordering", () => {
    const handle = rows()[1]!.querySelector<HTMLElement>(".path-editor-handle")!;
    expect(handle.getAttribute("aria-label")).toContain("B");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true }));
    expect(textarea().value).toBe("b // (alias: B)\na\n---");
    expect(controls(0, "outdent").getAttribute("aria-label")).toBe("Outdent B");
  });

  test("move controls reorder rows in both directions", () => {
    controls(0, "move down").click();
    expect(textarea().value).toBe("---\na\n>b // (alias: B)");

    controls(1, "move up").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("contains stale row controls and same-row drops after a rebuild", () => {
    const staleHandle = rows()[2]!.querySelector<HTMLElement>(".path-editor-handle")!;
    const staleEnabled = rows()[2]!.querySelector<HTMLInputElement>(".path-editor-enabled")!;
    const staleAlias = rows()[1]!.querySelector<HTMLInputElement>(".path-editor-alias")!;
    const staleAccessKey = rows()[1]!.querySelector<HTMLInputElement>(
      ".path-editor-access-key-input",
    )!;
    const staleOutdent = controls(1, "outdent");

    staleHandle.dispatchEvent(new Event("dragstart"));
    rows()[2]!.dispatchEvent(new Event("drop", { cancelable: true }));

    textarea().value = "only-one";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);

    staleHandle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    staleEnabled.dispatchEvent(new Event("change"));
    staleAlias.dispatchEvent(new InputEvent("input"));
    staleAccessKey.dispatchEvent(new InputEvent("input"));
    staleOutdent.click();
    expect(textarea().value).toBe("only-one");
  });

  test("keyboard nesting, enabled state, and directory edits commit", () => {
    rows()[0]!
      .querySelector<HTMLElement>(".path-editor-handle")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    let handle = rows()[2]!.querySelector<HTMLElement>(".path-editor-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    expect(textarea().value).toContain(">---");

    handle = rows()[2]!.querySelector<HTMLElement>(".path-editor-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }));
    handle = rows()[1]!.querySelector<HTMLElement>(".path-editor-handle")!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true }));
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    const enabled = rows()[0]!.querySelector<HTMLInputElement>(".path-editor-enabled")!;
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));
    expect(textarea().value).toContain("(disabled: true)");

    const dir = rows()[0]!.querySelector<HTMLInputElement>(".path-editor-dir")!;
    dir.value = "renamed";
    dir.dispatchEvent(new InputEvent("input"));
    expect(textarea().value).toContain("renamed");
  });

  test("keyboard reordering ignores the outer boundaries", () => {
    const first = rows()[0]!.querySelector<HTMLElement>(".path-editor-handle")!;
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true }));
    const last = rows()[2]!.querySelector<HTMLElement>(".path-editor-handle")!;
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true }));
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("uses fallback drag help and row labels when translations and paths are empty", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `
      <textarea id="paths">// comment only</textarea>
      <div id="path-editor-rows"></div>
    `;
    new PathEditor().setupVisualEditor();
    document.dispatchEvent(new Event("options-restored"));

    expect(document.querySelector(".path-editor-help")?.textContent).toContain(
      "Drag by the dotted handle",
    );
    expect(document.querySelector(".path-editor-handle")?.getAttribute("aria-label")).toContain(
      "Folder 1",
    );
  });

  test("undo before deletion and repeated external edits are harmless", () => {
    element<HTMLButtonElement>(".path-editor-undo").click();
    textarea().value = "first";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    textarea().value = "second";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(rows()[0]!.querySelector<HTMLInputElement>(".path-editor-dir")!.value).toBe("second");
  });

  test("typing in the textarea rebuilds the rows (debounced)", () => {
    textarea().value = "only-one";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(rows()).toHaveLength(1);
  });

  test("shows a useful empty state and hides irrelevant drag guidance", () => {
    textarea().value = "";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".path-editor-empty")?.textContent).toContain(
      "No custom folders",
    );
    expect(document.querySelector<HTMLElement>(".path-editor-help")!.hidden).toBe(true);
  });
});

describe("text/visual mode toggle", () => {
  let editor: PathEditor;

  beforeEach(() => {
    localStorage.removeItem("saveInPathsEditorMode");
    document.body.innerHTML = `
      <button type="button" class="editor-tab active" id="paths-mode-text">Text</button>
      <button type="button" class="editor-tab" id="paths-mode-visual">Visual</button>
      <div id="paths-text-editor">
        <div id="paths-editor-description">One relative directory per line.</div>
        <div id="paths-text-help"></div>
        <div class="editor-actions" id="paths-text-actions"><details id="paths-insert-menu"></details></div>
        <div class="manual-save-help"></div>
        <textarea id="paths">a</textarea>
      </div>
      <div id="error-paths"></div>
      <div id="paths-visual" hidden></div>
    `;
    editor = new PathEditor();
    editor.rebuildVisual = vi.fn();
    editor.setupModeToggle();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("switching to visual hides the text inputs and rebuilds the rows", () => {
    element<HTMLElement>("#paths-mode-visual").click();

    expect(element<HTMLElement>("#paths-text-editor").hidden).toBe(true);
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(false);
    expect(element<HTMLElement>("#error-paths").hidden).toBe(false);
    expect(element("#paths-mode-visual").getAttribute("aria-selected")).toBe("true");
    expect(element("#paths-mode-text").getAttribute("aria-selected")).toBe("false");
    expect(editor.rebuildVisual).toHaveBeenCalled();
  });

  test("defaults new profiles to the visual editor", () => {
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(false);
    expect(element("#paths-mode-visual").getAttribute("aria-selected")).toBe("true");
  });

  test("switching back restores the text input", () => {
    element<HTMLElement>("#paths-mode-visual").click();
    element<HTMLElement>("#paths-mode-text").click();

    expect(element<HTMLElement>("#paths-text-editor").hidden).toBe(false);
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(true);
    expect(element("#paths-mode-text").getAttribute("aria-selected")).toBe("true");
    expect(element("#paths-text-actions").nextElementSibling).toBe(element("#error-paths"));
  });

  test("keeps validation immediately after the active editor", () => {
    expect(element("#paths-visual").nextElementSibling).toBe(element("#error-paths"));

    element<HTMLElement>("#paths-mode-text").click();

    expect(element("#paths-text-actions").nextElementSibling).toBe(element("#error-paths"));
  });

  test("remembers the selected editor mode", () => {
    element<HTMLElement>("#paths-mode-text").click();
    expect(localStorage.getItem("saveInPathsEditorMode")).toBe("text");

    editor.setupModeToggle();
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(true);
  });

  test("switches tabs with the standard keyboard pattern", () => {
    const visual = element<HTMLButtonElement>("#paths-mode-visual");
    visual.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(element("#paths-mode-text"));
    expect(element<HTMLElement>("#paths-text-editor").hidden).toBe(false);

    element<HTMLButtonElement>("#paths-mode-text").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(visual);
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(false);
  });

  test("instances keep rebuild callbacks isolated", () => {
    const other = new PathEditor();
    other.rebuildVisual = vi.fn();
    vi.mocked(editor.rebuildVisual!).mockClear();

    element<HTMLElement>("#paths-mode-visual").click();

    expect(editor.rebuildVisual).toHaveBeenCalledOnce();
    expect(other.rebuildVisual).not.toHaveBeenCalled();
  });

  test("returns safely for incomplete markup and unavailable local storage", () => {
    document.body.innerHTML = '<textarea id="paths"></textarea>';
    expect(() => new PathEditor().setupModeToggle()).not.toThrow();

    document.body.innerHTML = `
      <button id="paths-mode-text"></button><button id="paths-mode-visual"></button>
      <div id="paths-text-editor"><textarea id="paths"></textarea></div>
      <div id="paths-visual"></div>`;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new PathEditor().setupModeToggle()).not.toThrow();
    element<HTMLElement>("#paths-mode-text").click();
  });
});

describe("text/visual mode with syntax editor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("saveInPathsEditorMode");
  });

  test("hides the highlighted editor and its active diagnostic tooltip", () => {
    localStorage.setItem("saveInPathsEditorMode", "text");
    document.body.innerHTML = `
      <button type="button" id="paths-mode-text">Text</button>
      <button type="button" id="paths-mode-visual">Visual</button>
      <div id="paths-text-editor">
        <div id="paths-text-help"></div>
        <div id="paths-text-actions"></div>
        <div id="paths-editor-description"></div>
        <textarea id="paths">a</textarea>
      </div>
      <div id="paths-visual" hidden></div>
    `;
    const textarea = element<HTMLTextAreaElement>("#paths");
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      { start: 0, end: 1, line: 1, column: 0, message: "Invalid path", severity: "error" },
    ]);
    const editor = new PathEditor();
    editor.setupModeToggle();
    const textPanel = element<HTMLElement>("#paths-text-editor");
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;

    textarea.setSelectionRange(0, 0);
    textarea.click();
    expect(tooltip.hidden).toBe(false);

    element<HTMLElement>("#paths-mode-visual").click();
    expect(textPanel.hidden).toBe(true);
    expect(tooltip.hidden).toBe(true);

    element<HTMLElement>("#paths-mode-text").click();
    expect(textPanel.hidden).toBe(false);
  });
});

test("visual editor contains non-node document clicks and enables variable completion", async () => {
  document.body.innerHTML = `
    <textarea id="paths">docs/</textarea>
    <div id="path-editor-rows"></div>`;
  const addEventListener = vi.spyOn(document, "addEventListener");
  vi.mocked(browser.runtime.sendMessage)
    .mockResolvedValueOnce({ body: { variables: "invalid" } })
    .mockResolvedValueOnce({ body: { variables: [":year:", 7] } })
    .mockResolvedValueOnce({ body: { variables: [] } });

  new PathEditor().setupVisualEditor();
  const clickListener = addEventListener.mock.calls.find(
    ([type, , options]) =>
      type === "click" && typeof options === "object" && options?.capture === true,
  )?.[1] as EventListener | undefined;
  clickListener?.({ target: window } as unknown as Event);

  document.body.insertAdjacentHTML(
    "beforeend",
    '<textarea id="paths-second">archive/</textarea><div id="rows-second"></div>',
  );
  const firstPaths = element<HTMLTextAreaElement>("#paths");
  firstPaths.id = "paths-old";
  const firstRows = element<HTMLElement>("#path-editor-rows");
  firstRows.id = "rows-old";
  element<HTMLTextAreaElement>("#paths-second").id = "paths";
  element<HTMLElement>("#rows-second").id = "path-editor-rows";
  new PathEditor().setupVisualEditor();
  await Promise.resolve();
  await Promise.resolve();

  const input = element<HTMLInputElement>("#path-editor-rows .path-editor-dir");
  input.value = "archive/:y";
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(document.querySelector(".autocomplete-option-label")?.textContent).toBe(":year:");
  document.dispatchEvent(new Event("options-restored"));
  new PathEditor().setupVisualEditor();
  await Promise.resolve();
  document.body.innerHTML = "";
});

test("top-level path editor setup tolerates absent option markup", () => {
  document.body.innerHTML = "";
  expect(() => setupPathEditor()).not.toThrow();
});

describe("insert menu targets its editor via data-insert-target", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("a rules menu inserts a line into #filenamePatterns", async () => {
    document.body.innerHTML = `
      <textarea id="filenamePatterns">fileext: pdf</textarea>
      <details id="rules-insert-menu" data-insert-target="filenamePatterns">
        <summary>+ Add</summary>
        <div>
          <input type="search" class="clause-preview-filter" />
          <table class="variables-preview-table clause-preview-table"><tbody></tbody></table>
        </div>
      </details>
    `;
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ body: { matchers: ["fileext", "pageurl", "context"] } }),
    );
    new PathEditor().setupInsertMenu("#rules-insert-menu");
    await Promise.resolve();
    await Promise.resolve();

    const textarea = element<HTMLTextAreaElement>("#filenamePatterns");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    element<HTMLElement>('[data-insert-line="into: "]').click();

    expect(textarea.value).toBe("fileext: pdf\ninto: ");
    expect(
      [...document.querySelectorAll(".clause-preview-table code")].map((node) => node.textContent),
    ).toEqual([
      "into:",
      "fetch:",
      "capture:",
      "capturegroups:",
      "context:",
      "pageurl:",
      "fileext:",
    ]);
    expect(
      [...document.querySelectorAll(".variables-preview-group")].map((node) => node.textContent),
    ).toEqual([
      "Output",
      "Capture setup",
      "Page and menu context",
      "URL and source matching",
      "Filename and content matching",
    ]);

    const clauseFilter = element<HTMLInputElement>(".clause-preview-filter");
    clauseFilter.value = "no match";
    clauseFilter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(
      [...document.querySelectorAll<HTMLTableRowElement>(".variables-preview-row")].every(
        (row) => row.hidden,
      ),
    ).toBe(true);
  });
});
