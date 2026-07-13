// @vitest-environment jsdom
import { PathEditor } from "../src/options/path-editor.ts";
import { refreshCounterPanel, setupCounterPanel } from "../src/options/counter-panel.ts";
import { setupDebugLogPanel, updateDebugLog } from "../src/options/debug-log-panel.ts";
import { renderVariablesPreview, setupVariablesPreview } from "../src/options/variables-preview.ts";
import { setupResetOptions } from "../src/options/reset-options.ts";
import { COUNTER_KEY, LOG_STORAGE_KEY } from "../src/shared/storage-keys.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    await flush();
    expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("7");

    document.querySelector<HTMLInputElement>("#counter-value")!.value = "12";
    document.querySelector<HTMLButtonElement>("#counter-set")!.click();
    await flush();
    expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 12 });

    document.querySelector<HTMLButtonElement>("#counter-reset")!.click();
    await flush();
    expect(browser.storage.local.set).toHaveBeenCalledWith({ [COUNTER_KEY]: 0 });
  });

  test("refreshes after a download advances the counter", async () => {
    document.body.innerHTML = '<input id="counter-value" value="0">';
    vi.mocked(browser.storage.local.get).mockResolvedValue({ [COUNTER_KEY]: 8 });
    await refreshCounterPanel();
    expect(document.querySelector<HTMLInputElement>("#counter-value")?.value).toBe("8");
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

  test("refreshes after clearing and tolerates unavailable session storage", async () => {
    vi.mocked(browser.storage.session.get)
      .mockResolvedValueOnce({ [LOG_STORAGE_KEY]: [{ message: "old" }] })
      .mockRejectedValueOnce(new Error("unsupported"));
    vi.mocked(browser.storage.session.remove).mockResolvedValue();
    setupDebugLogPanel();
    await flush();
    document.querySelector<HTMLButtonElement>("#debug-log-clear")!.click();
    await flush();
    expect(browser.storage.session.remove).toHaveBeenCalledWith(LOG_STORAGE_KEY);
    expect(document.querySelector<HTMLTextAreaElement>("#debug-log")!.value).toContain(
      "unavailable",
    );
  });
});

describe("variables preview", () => {
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
    expect(rows.map((row) => row.textContent)).toEqual([":title:example", ":url:https://x/"]);
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
      [...document.querySelectorAll<HTMLElement>(".variables-preview-command")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Separator", "Submenu item"]);
    expect(
      [...document.querySelectorAll<HTMLElement>(".variables-preview-group")].map(
        (row) => row.textContent,
      ),
    ).toEqual(["Page context", "Source URL"]);

    const filter = document.querySelector<HTMLInputElement>(".variables-preview-filter")!;
    filter.value = "title";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(rows[0]!.hidden).toBe(false);
    expect(rows[1]!.hidden).toBe(true);

    expect(document.querySelector(".variables-preview-structures")).toBeNull();
    const insertLine = vi.spyOn(PathEditor, "insertLine").mockImplementation(() => {});
    document.querySelector<HTMLButtonElement>(".variables-preview-command button")!.click();
    expect(insertLine).toHaveBeenCalledWith(
      document.querySelector<HTMLTextAreaElement>("#paths"),
      "---",
    );
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
});

describe("reset options", () => {
  test("removes only schema options, preserving history and other extension data", async () => {
    document.body.innerHTML = '<button id="reset"></button><span id="lastSavedAt"></span>';
    vi.mocked(browser.storage.local.remove).mockResolvedValue();
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ type: "OK" });
    const restoreOptions = vi.fn();
    const updateErrors = vi.fn();
    const hostWindow = {
      confirm: vi.fn(() => true),
      alert: vi.fn(),
    } as unknown as Window;
    setupResetOptions({
      restoreOptions,
      updateErrors,
      getOptionNames: () => Promise.resolve(["paths", "prompt"]),
      window: hostWindow,
    });

    document.querySelector<HTMLButtonElement>("#reset")!.click();
    await flush();
    expect(browser.storage.local.remove).toHaveBeenCalledWith(["paths", "prompt"]);
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "OPTIONS_LOADED" });
    expect(restoreOptions).toHaveBeenCalled();
    expect(updateErrors).toHaveBeenCalled();
    expect(hostWindow.alert).toHaveBeenCalledWith("Settings have been reset to defaults.");
  });

  test("does nothing when confirmation is declined", () => {
    document.body.innerHTML = '<button id="reset"></button>';
    const hostWindow = { confirm: vi.fn(() => false) } as unknown as Window;
    setupResetOptions({
      restoreOptions: vi.fn(),
      updateErrors: vi.fn(),
      getOptionNames: () => Promise.resolve(["paths"]),
      window: hostWindow,
    });
    document.querySelector<HTMLButtonElement>("#reset")!.click();
    expect(browser.storage.local.clear).not.toHaveBeenCalled();
  });
});
