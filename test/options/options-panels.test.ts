// @vitest-environment jsdom
import { PathEditor } from "../../src/options/path-editor.ts";
import { refreshCounterPanel, setupCounterPanel } from "../../src/options/counter-panel.ts";
import { setupDebugLogPanel, updateDebugLog } from "../../src/options/debug-log-panel.ts";
import {
  renderVariablesPreview,
  setupVariablesPreview,
} from "../../src/options/variables-preview.ts";
import { setupResetOptions } from "../../src/options/reset-options.ts";
import { COUNTER_KEY, LOG_STORAGE_KEY } from "../../src/shared/storage-keys.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("counter panel", () => {
  test("renders persisted state and resets it", async () => {
    document.body.innerHTML =
      '<input id="counter-value"><button id="counter-set"></button><button id="counter-reset"></button>';
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: 7 });
    vi.mocked(browser.storage.local.set).mockResolvedValue();

    setupCounterPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("7"),
    );

    document.querySelector<HTMLInputElement>("#counter-value")!.value = "12";
    document.querySelector<HTMLButtonElement>("#counter-set")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 12 }),
    );

    document.querySelector<HTMLButtonElement>("#counter-reset")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 0 }),
    );
  });

  test("refreshes after a download advances the counter", async () => {
    document.body.innerHTML = '<input id="counter-value" value="0">';
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: 8 });
    await refreshCounterPanel();
    expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("8");
  });

  test.each(["8", -1, 1.5, Number.NaN])(
    "renders malformed persisted counter %p as zero",
    async (stored) => {
      document.body.innerHTML = '<input id="counter-value" value="7">';
      vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: stored });

      await refreshCounterPanel();

      expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("0");
    },
  );

  test("validates edits and supports the keyboard without writing malformed values", async () => {
    document.body.innerHTML =
      '<input id="counter-value"><button id="counter-set"></button><button id="counter-reset"></button>';
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    vi.mocked(browser.storage.local.set).mockResolvedValue();
    setupCounterPanel();
    const input = document.querySelector<HTMLInputElement>("#counter-value")!;
    const reportValidity = vi.spyOn(input, "reportValidity").mockReturnValue(false);
    await vi.waitFor(() => expect(input.value).toBe("0"));

    input.value = "-1";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(reportValidity).toHaveBeenCalledOnce();
    expect(input.validationMessage).toContain("whole number");

    input.value = "9";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() =>
      expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 9 }),
    );
    expect(input.validationMessage).toBe("");
  });

  test("does nothing until all controls exist and tolerates a refresh without an input", async () => {
    document.body.innerHTML = '<input id="counter-value">';
    setupCounterPanel();
    expect(browser.storage.local.get).not.toHaveBeenCalled();

    document.body.innerHTML = "";
    vi.mocked(browser.storage.local.get).mockResolvedValue({});
    await expect(refreshCounterPanel()).resolves.toBeUndefined();
  });
});

describe("debug log panel", () => {
  beforeEach(() => {
    Object.defineProperty(browser.storage, "session", {
      configurable: true,
      value: { get: vi.fn(), remove: vi.fn() },
    });
    document.body.innerHTML = `
      <textarea id="debug-log"></textarea>
      <button id="debug-log-refresh"></button>
      <button id="debug-log-clear"></button>`;
  });

  test("formats valid entries and ignores malformed persisted values", async () => {
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      [LOG_STORAGE_KEY]: [null, "bad", { at: "now", message: "saved", data: { id: 3 } }],
    });
    await updateDebugLog();
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toBe(
      'now  saved  {"id":3}',
    );
  });

  test("contains values that JSON serialization cannot represent", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    circular.toString = () => {
      throw new Error("cannot stringify");
    };
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      [LOG_STORAGE_KEY]: [{ at: "now", message: 7n, data: circular }],
    });

    await updateDebugLog();

    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toBe(
      "now  7  [unprintable]",
    );
  });

  test("ignores refreshes without a log field and non-array storage", async () => {
    document.body.innerHTML = "";
    await expect(updateDebugLog()).resolves.toBeUndefined();

    document.body.innerHTML = '<textarea id="debug-log"></textarea>';
    vi.mocked(browser.storage.session.get).mockResolvedValue({ [LOG_STORAGE_KEY]: "invalid" });
    await updateDebugLog();
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toBe("");
  });

  test("formats null fields and contains a failed clear", async () => {
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      [LOG_STORAGE_KEY]: [{ at: null, message: 7, data: false }],
    });
    vi.mocked(browser.storage.session.remove).mockRejectedValue(new Error("denied"));
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toBe("7  false"),
    );

    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();
    await vi.waitFor(() => expect(browser.storage.session.remove).toHaveBeenCalled());
  });

  test("refreshes after clearing and tolerates unavailable session storage", async () => {
    vi.mocked(browser.storage.session.get)
      .mockResolvedValueOnce({ [LOG_STORAGE_KEY]: [{ message: "old" }] })
      .mockRejectedValueOnce(new Error("unsupported"));
    vi.mocked(browser.storage.session.remove).mockResolvedValue();
    setupDebugLogPanel();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toContain("old"),
    );
    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toContain(
        "unavailable",
      ),
    );
    expect(browser.storage.session.remove).toHaveBeenCalledWith(LOG_STORAGE_KEY);
  });

  test("refreshes from the explicit refresh button", async () => {
    vi.mocked(browser.storage.session.get).mockResolvedValue({
      [LOG_STORAGE_KEY]: [{ message: "fresh" }],
    });
    setupDebugLogPanel();
    vi.mocked(browser.storage.session.get).mockClear();

    document.querySelector<HTMLButtonElement>("#debug-log-refresh")!.click();

    await vi.waitFor(() => expect(browser.storage.session.get).toHaveBeenCalledOnce());
  });
});

describe("variables preview", () => {
  test("does nothing without preview panels", async () => {
    document.body.innerHTML = "";
    await expect(renderVariablesPreview()).resolves.toBeUndefined();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test("closes an open live-variable list when clicking outside", () => {
    document.body.innerHTML = `
      <details class="variables-preview" open>
        <summary>Live variable list</summary>
        <div class="variables-preview-list"></div>
      </details>
      <button id="outside">Outside</button>`;
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ body: { variables: [] } });

    setupVariablesPreview();
    document.querySelector<HTMLButtonElement>("#outside")!.click();

    expect(document.querySelector<HTMLDetailsElement>(".variables-preview")!.open).toBe(false);
  });

  test("renders only string variables and values and supports insertion", async () => {
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>
      <section id="options-reference-variables">
        <table><tbody>
          <tr>
            <td><code>:url:</code></td><td>https://example/file.jpg</td>
            <td>Localized source URL description</td>
          </tr>
          <tr><td><code>---</code></td><td>Separator</td><td>Add a menu divider</td></tr>
          <tr>
            <td><code>&gt;submenu</code></td><td>submenu</td>
            <td>Add an item under the folder above to create a submenu</td>
          </tr>
        </tbody></table>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:", 7, ":title:"] } })
      .mockResolvedValueOnce({
        body: { interpolatedVariables: { ":url:": "https://x/", ":title:": 9 } },
      });
    const insert = vi.spyOn(PathEditor, "insertAtCursor").mockImplementation(() => {});

    await renderVariablesPreview();
    const rows = [
      ...document.querySelectorAll<HTMLElement>(
        ".variables-preview-row:not(.variables-preview-command)",
      ),
    ];
    expect(
      rows.map((row) => ({
        name: row.querySelector("code")?.textContent,
        value: row.querySelector(".variables-preview-value")?.textContent,
        description: row.querySelector(".variables-preview-description")?.textContent,
      })),
    ).toEqual([
      {
        name: ":title:",
        value: "example",
        description: "Translated<referenceRuntimeVariable>",
      },
      {
        name: ":url:",
        value: "https://x/",
        description: "Localized source URL description",
      },
    ]);
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".variables-preview-row:not(.variables-preview-command) .variables-preview-insert",
      ),
    ];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.type).toBe("button");
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Insert :title:");
    buttons[0]!.click();
    expect(insert).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ":title:",
    );
    expect(
      [...document.querySelectorAll<HTMLElement>(".variables-preview-command")].map((row) => ({
        syntax: row.querySelector("code")?.textContent,
        label: row.querySelector(".variables-preview-command-label")?.textContent,
        description: row.querySelector(".variables-preview-description")?.textContent,
        insertable: row.classList.contains("insertable"),
      })),
    ).toEqual([
      {
        syntax: "---",
        label: "Translated<o_bAddSeparator>",
        description: "Add a menu divider",
        insertable: true,
      },
      {
        syntax: ">submenu",
        label: "Translated<html_createASubmenu>",
        description: "Add an item under the folder above to create a submenu",
        insertable: true,
      },
    ]);
    expect(
      [...document.querySelectorAll<HTMLElement>(".variables-preview-group")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Page context", "Source URL"]);

    const filter = document.querySelector<HTMLInputElement>(".variables-preview-filter")!;
    expect(filter.name).toBe("variable-filter");
    filter.value = "title";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(rows[0]!.hidden).toBe(false);
    expect(rows[1]!.hidden).toBe(true);

    expect(document.querySelector(".variables-preview-structures")).toBeNull();
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    const commandButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(".variables-preview-command button"),
    ];
    commandButtons[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
    commandButtons[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ">submenu",
    );
  });

  test("inserts variables into the focused visual folder instead of the hidden textarea", async () => {
    document.body.innerHTML = `
      <textarea id="paths">images</textarea>
      <div id="paths-visual">
        <input class="path-editor-dir" value="images">
      </div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });
    const insert = vi.spyOn(PathEditor, "insertAtCursor").mockImplementation(() => {});

    await renderVariablesPreview();
    const folder = document.querySelector<HTMLInputElement>(".path-editor-dir")!;
    folder.focus();
    document
      .querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command]):not(:disabled)",
      )!
      .click();

    expect(insert).toHaveBeenCalledWith(folder, ":year:");
    expect(insert).not.toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      ":year:",
    );
  });

  test("disables visual insertion until a folder field has been focused", async () => {
    document.body.innerHTML = `
      <textarea id="paths">images</textarea>
      <div id="paths-visual"><input class="path-editor-dir" value="images"></div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();

    expect(
      document.querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command])",
      )!.disabled,
    ).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("[data-path-command]")].every(
        (button) => !button.disabled,
      ),
    ).toBe(true);
  });

  test("tracks text-mode focus and clears a removed visual target", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <button id="paths-mode-text"></button>
      <button id="paths-mode-visual"></button>
      <div id="paths-visual"><input class="path-editor-dir"></div>
      <section class="variables-preview" data-insert-target="paths">
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":year:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();
    expect(document.querySelector<HTMLElement>("#paths-visual")!.hidden).toBe(false);
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    document
      .querySelector<HTMLButtonElement>(".variables-preview-command button")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
    const folder = document.querySelector<HTMLInputElement>(".path-editor-dir")!;
    folder.focus();
    document.dispatchEvent(new Event("visual-editor-rendered"));
    folder.remove();
    document.dispatchEvent(new Event("visual-editor-rendered"));
    expect(
      document.querySelector<HTMLButtonElement>(
        ".variables-preview-insert:not([data-path-command])",
      )!.disabled,
    ).toBe(true);
    document
      .querySelector<HTMLButtonElement>(".variables-preview-insert:not([data-path-command])")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    document.querySelector<HTMLTextAreaElement>("#paths")!.focus();
    document.querySelector<HTMLButtonElement>("#paths-mode-text")!.click();
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  test("shows known variables with blank values before a save", async () => {
    document.body.innerHTML =
      '<section class="variables-preview"><div class="variables-preview-list"></div></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:", ":title:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: { ":url:": false } } });
    await renderVariablesPreview();
    expect(document.querySelector(".variables-preview-empty")).toBeNull();
    const values = [...document.querySelectorAll<HTMLElement>(".variables-preview-value")];
    expect(values.map((value) => value.textContent)).toEqual([
      "example",
      "https://example.com/file.jpg",
    ]);
    expect(values.every((value) => value.title.startsWith("Example —"))).toBe(true);
  });

  test("labels unresolved network-derived variables as lazy", async () => {
    document.body.innerHTML =
      '<section class="variables-preview"><div class="variables-preview-list"></div></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":sha256:", ":mime:", ":filename:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });

    await renderVariablesPreview();

    const rows = [...document.querySelectorAll<HTMLElement>(".variables-preview-row")];
    expect(rows.find((row) => row.textContent?.includes(":sha256:"))?.textContent).toContain(
      "(lazy)",
    );
    expect(rows.find((row) => row.textContent?.includes(":mime:"))?.textContent).toContain(
      "(lazy)",
    );
    expect(rows.find((row) => row.textContent?.includes(":filename:"))?.textContent).toContain(
      "photo.jpg",
    );
  });

  test("contains unavailable route values and panels without a list container", async () => {
    document.body.innerHTML = '<section class="variables-preview"></section>';
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: {} })
      .mockRejectedValueOnce(new Error("worker restarting"));

    await expect(renderVariablesPreview()).resolves.toBeUndefined();
    expect(document.querySelector(".variables-preview-filter")).toBeNull();
  });

  test("supports filter keyboard dismissal and inserts the first visible result", async () => {
    document.body.innerHTML = `
      <textarea id="paths"></textarea>
      <section class="variables-preview" data-insert-target="paths" open>
        <div class="variables-preview-list"></div>
      </section>`;
    vi.mocked(browser.runtime.sendMessage)
      .mockResolvedValueOnce({ body: { variables: [":url:"] } })
      .mockResolvedValueOnce({ body: { interpolatedVariables: {} } });
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    await renderVariablesPreview();
    const panel = document.querySelector<HTMLElement>(".variables-preview")!;
    const filter = document.querySelector<HTMLInputElement>(".variables-preview-filter")!;

    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panel.hasAttribute("open")).toBe(false);
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    filter.value = "no match";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(insertLine).not.toHaveBeenCalled();

    filter.value = "";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
  });
});

describe("reset options", () => {
  test("removes only schema options, preserving history and other extension data", async () => {
    document.body.innerHTML =
      '<button id="reset"></button><div id="settings-reset-status"></div><span id="lastSavedAt"></span>';
    vi.mocked(browser.storage.local.remove).mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ type: "OK" });
    const restoreOptions = vi.fn();
    const updateErrors = vi.fn();
    setupResetOptions({
      restoreOptions,
      updateErrors,
      getOptionNames: () => Promise.resolve(["paths", "prompt"]),
      localize: () => "",
    });

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();
    await vi.waitFor(() =>
      expect(browser.storage.local.remove).toHaveBeenCalledWith(["paths", "prompt"]),
    );
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "OPTIONS_LOADED" });
    expect(restoreOptions).toHaveBeenCalled();
    expect(updateErrors).toHaveBeenCalled();
    const status = document.querySelector<HTMLElement>("#settings-reset-status")!;
    expect(status.textContent).toBe("Default settings restored.");
    expect(status.classList).toContain("feedback-success");
    expect(status.getAttribute("role")).toBe("status");
  });

  test("does nothing when confirmation is declined", async () => {
    document.body.innerHTML = '<button id="reset"></button>';
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }),
    });
    setupResetOptions({
      restoreOptions: vi.fn(),
      updateErrors: vi.fn(),
      getOptionNames: () => Promise.resolve(["paths"]),
      localize: () => "",
    });
    document.querySelector<HTMLButtonElement>("#reset")!.click();
    let dialog = document.querySelector<HTMLDialogElement>(".reset-settings-dialog")!;
    expect(dialog.getAttribute("aria-describedby")).toBe("reset-settings-description");
    dialog.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
    expect(document.querySelector(".reset-settings-dialog")).toBeNull();

    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    document.querySelector<HTMLButtonElement>("#reset")!.click();
    dialog = document.querySelector<HTMLDialogElement>(".reset-settings-dialog")!;
    expect(dialog.open).toBe(true);
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    await Promise.resolve();

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();
    await vi.waitFor(() => expect(browser.storage.local.remove).toHaveBeenCalledWith(["paths"]));
  });

  test("reports a reset failure without restoring stale controls", async () => {
    document.body.innerHTML = '<button id="reset"></button><div id="settings-reset-status"></div>';
    vi.mocked(browser.storage.local.remove).mockRejectedValueOnce(new Error("storage denied"));
    const restoreOptions = vi.fn();
    setupResetOptions({
      restoreOptions,
      updateErrors: vi.fn(),
      getOptionNames: () => Promise.resolve(["paths"]),
      localize: () => "",
    });

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    document.querySelector<HTMLButtonElement>(".reset-settings-confirm")!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#settings-reset-status")?.textContent).toBe(
        "Could not restore default settings.",
      ),
    );
    expect(document.querySelector("#settings-reset-status")?.classList).toContain("feedback-error");
    expect(restoreOptions).not.toHaveBeenCalled();
  });
});
