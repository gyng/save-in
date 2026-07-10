// Paths insert menu + visual directory editor: pure line helpers must
// round-trip the textarea syntax losslessly, and the visual editor must
// serialize every edit back to the textarea (the source of truth).

const constants = (await import("../src/constants.js")).default;
global.SPECIAL_DIRS = constants.SPECIAL_DIRS;

const PathEditor = (await import("../src/options/path-editor.js")).default;

describe("line helpers", () => {
  test("parseLine extracts depth, body, and comment", () => {
    expect(PathEditor.parseLine("images")).toEqual({ depth: 0, body: "images", comment: "" });
    expect(PathEditor.parseLine(">>i/cats // cute (alias: Cats)")).toEqual({
      depth: 2,
      body: "i/cats",
      comment: "cute (alias: Cats)",
    });
    expect(PathEditor.parseLine("---")).toEqual({ depth: 0, body: "---", comment: "" });
    expect(PathEditor.parseLine(">---")).toEqual({ depth: 1, body: "---", comment: "" });
  });

  test("serializeLine round-trips parseLine", () => {
    const lines = ["images", ">>i/cats // cute (alias: Cats)", "---", ">---", "docs/:year:"];
    lines.forEach((line) => {
      expect(PathEditor.serializeLine(PathEditor.parseLine(line))).toBe(line);
    });
  });

  test("linesToRows drops blank lines", () => {
    const rows = PathEditor.linesToRows("a\n\n  \n>b\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ depth: 1, body: "b", comment: "" });
  });

  test("getAlias and setAlias edit only the alias meta", () => {
    expect(PathEditor.getAlias("cute (alias: Cats) (key: c)")).toBe("Cats");
    expect(PathEditor.getAlias("no alias here")).toBe("");

    expect(PathEditor.setAlias("cute (alias: Cats) (key: c)", "Dogs")).toBe(
      "cute (key: c) (alias: Dogs)",
    );
    expect(PathEditor.setAlias("", "Dogs")).toBe("(alias: Dogs)");
    expect(PathEditor.setAlias("cute (alias: Cats)", "")).toBe("cute");
  });
});

describe("insertAtCursor / insertLine", () => {
  let textarea;
  let inputs;

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
});

describe("visual editor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths">a\n>b // (alias: B)\n---</textarea>
      <button type="button" id="path-editor-add-dir"></button>
      <button type="button" id="path-editor-add-sep"></button>
      <div id="path-editor-rows"></div>
      <div id="menu-preview-tree-visual"></div>
    `;
    global.renderMenuPreview = vi.fn();
    global.browser.runtime.sendMessage = vi.fn(() =>
      Promise.resolve({ body: { items: [], errors: [] } }),
    );
    PathEditor.setupVisualEditor();
    vi.advanceTimersByTime(1500); // initial rebuild after options restore
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    delete global.renderMenuPreview;
  });

  const textarea = () => document.querySelector("#paths");
  const rows = () => document.querySelectorAll(".path-editor-row");
  const controls = (row, title) => rows()[row].querySelector(`[title="${title}"]`);

  test("renders one row per line, separators included", () => {
    expect(rows()).toHaveLength(3);
    expect(rows()[0].querySelector(".path-editor-dir").value).toBe("a");
    expect(rows()[1].querySelector(".path-editor-alias").value).toBe("B");
    expect(rows()[2].querySelector(".path-editor-separator")).not.toBeNull();
  });

  test("indent and outdent rewrite the textarea", () => {
    controls(0, "indent").click();
    expect(textarea().value).toBe(">a\n>b // (alias: B)\n---");

    vi.advanceTimersByTime(500); // rebuild debounce
    controls(0, "outdent").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---");
  });

  test("moving a row down reorders the lines", () => {
    controls(0, "move down").click();
    expect(textarea().value).toBe(">b // (alias: B)\na\n---");
  });

  test("deleting a row removes its line", () => {
    controls(2, "delete").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)");
  });

  test("editing the alias field updates only the alias meta", () => {
    const alias = rows()[1].querySelector(".path-editor-alias");
    alias.value = "Better";
    alias.dispatchEvent(new Event("change", { bubbles: true }));
    expect(textarea().value).toBe("a\n>b // (alias: Better)\n---");
  });

  test("toolbar buttons append rows", () => {
    document.querySelector("#path-editor-add-dir").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---\nnew-folder");

    vi.advanceTimersByTime(500);
    document.querySelector("#path-editor-add-sep").click();
    expect(textarea().value).toBe("a\n>b // (alias: B)\n---\nnew-folder\n---");
  });

  test("typing in the textarea rebuilds the rows (debounced)", () => {
    textarea().value = "only-one";
    textarea().dispatchEvent(new InputEvent("input", { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(rows()).toHaveLength(1);
  });
});

describe("insert menu typeahead", () => {
  let sendMessage;

  beforeEach(async () => {
    document.body.innerHTML = `
      <textarea id="paths">a</textarea>
      <details id="paths-insert-menu">
        <summary>+ Add</summary>
        <div>
          <input type="text" id="paths-insert-filter" />
          <button type="button" data-insert-line="---">separator</button>
          <div id="paths-insert-variables"></div>
        </div>
      </details>
    `;
    sendMessage = vi.fn((msg) => {
      if (msg.type === "GET_KEYWORDS") {
        return Promise.resolve({ body: { variables: [":date:", ":pagetitle:"] } });
      }
      if (msg.type === "CHECK_ROUTES") {
        return Promise.resolve({
          body: { interpolatedVariables: { ":date:": "2026-07-10" } },
        });
      }
      return Promise.resolve({});
    });
    global.browser.runtime.sendMessage = sendMessage;
    PathEditor.setupInsertMenu();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const buttons = () => [...document.querySelectorAll(".insert-menu-variable")];
  const filter = () => document.querySelector("#paths-insert-filter");

  test("lists variables with their current values", () => {
    expect(buttons().map((b) => b.querySelector("code").textContent)).toEqual([
      ":date:",
      ":pagetitle:",
    ]);
    expect(buttons()[0].querySelector(".insert-menu-value").textContent).toBe("2026-07-10");
    expect(buttons()[0].title).toBe("2026-07-10");
    expect(buttons()[1].querySelector(".insert-menu-value").textContent).toBe("");
  });

  test("typing filters by name and by current value", () => {
    filter().value = "title";
    filter().dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(buttons()[0].style.display).toBe("none");
    expect(buttons()[1].style.display).toBe("");

    // Value text matches too
    filter().value = "2026";
    filter().dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(buttons()[0].style.display).toBe("");
    expect(buttons()[1].style.display).toBe("none");
  });

  test("Enter inserts the first visible match at the cursor", () => {
    const textarea = document.querySelector("#paths");
    textarea.setSelectionRange(1, 1);

    filter().value = "page";
    filter().dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(textarea.value).toBe("a:pagetitle:");
    expect(document.querySelector("#paths-insert-menu").open).toBe(false);
  });

  test("values refresh each time the menu opens", async () => {
    const menu = document.querySelector("#paths-insert-menu");
    sendMessage.mockClear();
    menu.open = true;
    menu.dispatchEvent(new Event("toggle"));
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledWith({ type: "CHECK_ROUTES" });
  });
});
