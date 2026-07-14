// @vitest-environment jsdom
// Paths insert menu + visual directory editor: pure line helpers must
// round-trip the textarea syntax losslessly, and the visual editor must
// serialize every edit back to the textarea (the source of truth).

import { PathEditor, setupPathEditor } from "../src/options/path-editor.ts";
import { createSyntaxEditor, setSyntaxEditorDiagnostics } from "../src/options/syntax-editor.ts";

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
});

describe("visual editor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths">a\n>b // (alias: B)\n---</textarea>
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
    vi.advanceTimersByTime(1500); // initial rebuild after options restore
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const textarea = () => element<HTMLTextAreaElement>("#paths");
  const rows = () => document.querySelectorAll<HTMLElement>(".path-editor-row");
  const controls = (row: number, title: string) =>
    rows()[row]!.querySelector<HTMLElement>(`[title="${title}"]`)!;

  test("renders one row per line, separators included", () => {
    expect(rows()).toHaveLength(3);
    expect(rows()[0]!.querySelector<HTMLInputElement>(".path-editor-dir")!.value).toBe("a");
    expect(rows()[1]!.querySelector<HTMLInputElement>(".path-editor-alias")!.value).toBe("B");
    expect(rows()[2]!.querySelector(".path-editor-separator")).not.toBeNull();
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
      true,
    );

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
  });

  test("indent and outdent rewrite the textarea", () => {
    expect((controls(0, "indent") as HTMLButtonElement).disabled).toBe(true);
    controls(1, "outdent").click();
    expect(textarea().value).toBe("a\nb // (alias: B)\n---");

    vi.advanceTimersByTime(500); // rebuild debounce
    controls(1, "indent").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("moving a row down reorders the lines", () => {
    controls(0, "move down").click();
    expect(textarea().value).toBe("b // (alias: B)\na\n---");
  });

  test("moving a row up reorders the lines", () => {
    controls(1, "move up").click();
    expect(textarea().value).toBe("b // (alias: B)\na\n---");
  });

  test("deleting a row removes its line", () => {
    controls(2, "delete").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)");
    element<HTMLButtonElement>(".path-editor-undo").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("deleting a parent promotes its children and undo restores the hierarchy", () => {
    textarea().value = "parent\n>child\n>>grandchild\nsibling";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    controls(0, "delete").click();
    expect(textarea().value).toBe("child\n>grandchild\nsibling");
    element<HTMLButtonElement>(".path-editor-undo").click();
    expect(textarea().value).toBe("parent\n>child\n>>grandchild\nsibling");
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
    vi.advanceTimersByTime(1500);

    expect(document.querySelector(".path-editor-help")?.textContent).toContain(
      "Drag by the dotted handle",
    );
    expect(document.querySelector(".path-editor-handle")?.getAttribute("aria-label")).toContain(
      "row 1",
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
});

describe("text/visual mode toggle", () => {
  let editor: PathEditor;

  beforeEach(() => {
    localStorage.removeItem("saveInPathsEditorMode");
    document.body.innerHTML = `
      <button type="button" class="editor-tab active" id="paths-mode-text">Text</button>
      <button type="button" class="editor-tab" id="paths-mode-visual">Visual</button>
      <div id="paths-editor-description">One relative directory per line.</div>
      <div id="paths-text-help"></div>
      <div id="paths-text-actions"><details id="paths-insert-menu"></details></div>
      <div class="manual-save-help"></div>
      <textarea id="paths">a</textarea>
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

    expect(element<HTMLElement>("#paths").hidden).toBe(true);
    expect(element<HTMLElement>("#paths-text-actions").hidden).toBe(true);
    expect(element<HTMLElement>("#paths-text-help").hidden).toBe(true);
    expect(element<HTMLElement>("#paths-editor-description").hidden).toBe(true);
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

    expect(element<HTMLElement>("#paths").hidden).toBe(false);
    expect(element<HTMLElement>("#paths-editor-description").hidden).toBe(false);
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(true);
    expect(element("#paths-mode-text").getAttribute("aria-selected")).toBe("true");
  });

  test("remembers the selected editor mode", () => {
    element<HTMLElement>("#paths-mode-text").click();
    expect(localStorage.getItem("saveInPathsEditorMode")).toBe("text");

    editor.setupModeToggle();
    expect(element<HTMLElement>("#paths-visual").hidden).toBe(true);
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
      <div id="paths-text-help"></div><div id="paths-text-actions"></div>
      <textarea id="paths"></textarea><div id="paths-visual"></div>`;
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
      <div id="paths-text-help"></div>
      <div id="paths-text-actions"></div>
      <div id="paths-editor-description"></div>
      <textarea id="paths">a</textarea>
      <div id="paths-visual" hidden></div>
    `;
    const textarea = element<HTMLTextAreaElement>("#paths");
    createSyntaxEditor(textarea, "directories");
    setSyntaxEditorDiagnostics(textarea, [
      { start: 0, end: 1, line: 1, column: 0, message: "Invalid path", severity: "error" },
    ]);
    const editor = new PathEditor();
    editor.setupModeToggle();
    const editorSurface = textarea.closest<HTMLElement>('[data-language="directories"]')!;
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;

    textarea.setSelectionRange(0, 0);
    textarea.click();
    expect(tooltip.hidden).toBe(false);

    element<HTMLElement>("#paths-mode-visual").click();
    expect(editorSurface.hidden).toBe(true);
    expect(tooltip.hidden).toBe(true);

    element<HTMLElement>("#paths-mode-text").click();
    expect(editorSurface.hidden).toBe(false);
  });
});

describe("visual editor drag and drop", () => {
  const dragEvent = (type: string, clientX: number, clientY = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clientX", { value: clientX });
    Object.defineProperty(event, "clientY", { value: clientY });
    return event;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths">a\nb\nc</textarea>
      <div id="path-editor-rows"></div>
    `;
    global.browser.runtime.sendMessage = vi.fn(() => Promise.resolve({}));
    new PathEditor().setupVisualEditor();
    vi.advanceTimersByTime(1500);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("dropping a dragged row onto another reorders the lines", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    // Drag row 0 ("a") and drop it on row 2 ("c")
    rows[0]!.querySelector(".path-editor-handle")!.dispatchEvent(new Event("dragstart"));
    rows[2]!.dispatchEvent(new Event("drop"));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("b\nc\na");
  });

  test("dropping a row on itself is a no-op", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    rows[1]!.querySelector(".path-editor-handle")!.dispatchEvent(new Event("dragstart"));
    rows[1]!.dispatchEvent(new Event("drop"));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nb\nc");
  });

  test("a drop without a drag is ignored", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    rows[0]!.dispatchEvent(new Event("drop"));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nb\nc");
  });

  test("before/after drops adopt the target depth regardless of horizontal movement", () => {
    element<HTMLTextAreaElement>("#paths").value = "a\n>b\nc";
    element<HTMLTextAreaElement>("#paths").dispatchEvent(
      new InputEvent("input", { bubbles: true }),
    );
    vi.advanceTimersByTime(500);
    const rows = document.querySelectorAll(".path-editor-row");
    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 100));
    rows[1]!.dispatchEvent(dragEvent("dragover", 500));
    rows[1]!.dispatchEvent(dragEvent("drop", 20));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\n>b\n>c");
  });

  test("the upper drop zone inserts before the target", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    vi.spyOn(rows[1]!, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 160,
      height: 60,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 0));
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 105));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")?.textContent).toContain(
      "Insert before",
    );
    rows[1]!.dispatchEvent(dragEvent("drop", 0, 105));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nc\nb");
  });

  test("horizontal movement on the same row has no effect", () => {
    const rows = document.querySelectorAll(".path-editor-row");
    rows[1]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 100));
    rows[1]!.dispatchEvent(dragEvent("drop", 500));

    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\nb\nc");
  });

  test("the middle drop zone moves a row inside the highlighted group", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    vi.spyOn(rows[0]!, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 160,
      height: 60,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    rows[2]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 100));
    rows[0]!.dispatchEvent(dragEvent("dragover", 100, 130));

    rows[0]!.dispatchEvent(dragEvent("drop", 100, 130));
    expect(element<HTMLTextAreaElement>("#paths").value).toBe("a\n>c\nb");
  });

  test("nesting never creates a depth jump beneath a deeply nested target", () => {
    const textarea = element<HTMLTextAreaElement>("#paths");
    textarea.value = "group\n>child\n>>grandchild\nsibling";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    vi.spyOn(rows[2]!, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 160,
      height: 60,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    rows[3]!.querySelector(".path-editor-handle")!.dispatchEvent(dragEvent("dragstart", 100));
    rows[2]!.dispatchEvent(dragEvent("dragover", 100, 130));
    rows[2]!.dispatchEvent(dragEvent("drop", 100, 130));

    expect(textarea.value).toBe("group\n>child\n>>grandchild\n>>>sibling");
    expect(textarea.value).not.toContain(">>>>sibling");
  });

  test("moving a parent away promotes orphaned children instead of creating invalid nesting", () => {
    const textarea = element<HTMLTextAreaElement>("#paths");
    textarea.value = "parent\n>child\nsibling";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    rows[0]!.querySelector(".path-editor-handle")!.dispatchEvent(new Event("dragstart"));
    rows[2]!.dispatchEvent(new Event("drop"));

    expect(textarea.value).toBe("child\nsibling\nparent");
  });

  test("drag lifecycle supports Firefox data transfer and clears indicators", () => {
    const rows = document.querySelectorAll<HTMLElement>(".path-editor-row");
    const handle = rows[0]!.querySelector<HTMLElement>(".path-editor-handle")!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" };
    const start = dragEvent("dragstart", 0);
    Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
    handle.dispatchEvent(start);
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "0");
    expect(dataTransfer.effectAllowed).toBe("move");

    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).not.toBeNull();
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    handle.dispatchEvent(new Event("dragend"));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBeNull();

    handle.dispatchEvent(start);
    rows[1]!.dispatchEvent(dragEvent("dragover", 0, 0));
    rows[1]!.dispatchEvent(dragEvent("dragleave", 0));
    expect(rows[1]!.querySelector(".path-editor-drop-indicator")).toBeNull();
  });

  test("dragover without an active drag leaves the row unchanged", () => {
    const row = document.querySelectorAll<HTMLElement>(".path-editor-row")[0]!;
    const event = dragEvent("dragover", 0, 0);
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(row.querySelector(".path-editor-drop-indicator")).toBeNull();
  });
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
    ).toEqual(["into:", "capture:", "capturegroups:", "context:", "pageurl:", "fileext:"]);
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
