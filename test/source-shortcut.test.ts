// @vitest-environment jsdom
import { setupSourceShortcut, validateSourceShortcut } from "../src/options/source-shortcut.ts";

describe("Page Sources shortcut control", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <select id="sourcePanelShortcutModifier"><option>Ctrl</option><option>Alt</option></select>
      <select id="sourcePanelShortcutModifier2"><option value="">None</option><option>Shift</option></select>
      <input id="sourcePanelShortcutKey">
      <button id="sourcePanelShortcutApply"></button>
      <button id="sourcePanelShortcutReset"></button>
      <span id="sourcePanelShortcutStatus"></span>`;
    (global.browser as any).commands = {
      getAll: vi.fn(() =>
        Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }]),
      ),
      update: vi.fn(() => Promise.resolve()),
      reset: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => vi.restoreAllMocks());

  test("loads and updates the browser-owned shortcut", async () => {
    setupSourceShortcut();
    await vi.waitFor(() =>
      expect((document.querySelector("#sourcePanelShortcutKey") as HTMLInputElement).value).toBe(
        "Y",
      ),
    );
    const modifier = document.querySelector("#sourcePanelShortcutModifier") as HTMLSelectElement;
    const key = document.querySelector("#sourcePanelShortcutKey") as HTMLInputElement;
    modifier.value = "Alt";
    modifier.dispatchEvent(new Event("change"));
    key.value = "S";
    key.dispatchEvent(new InputEvent("input"));
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!.click();
    await vi.waitFor(() =>
      expect(global.browser.commands.update).toHaveBeenCalledWith({
        name: "toggle-source-panel",
        shortcut: "Alt+Shift+S",
      }),
    );
  });

  test("resets the command through the browser API", async () => {
    setupSourceShortcut();
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    await vi.waitFor(() =>
      expect(global.browser.commands.reset).toHaveBeenCalledWith("toggle-source-panel"),
    );
  });

  test("degrades cleanly when the host cannot update commands", async () => {
    (global.browser as any).commands = {
      getAll: vi.fn(() =>
        Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }]),
      ),
    };
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Y"));

    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    apply.click();
    expect(status.textContent).toBe("Translated<o_lShortcutChangeUnsupported>");
    expect(apply.disabled).toBe(false);

    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    expect(status.textContent).toBe("Translated<o_lShortcutResetUnsupported>");
  });

  test("validates a modifier plus one key", () => {
    expect(validateSourceShortcut("Ctrl+Shift+G")).toBe("");
    expect(validateSourceShortcut("Alt+S")).toBe("");
    expect(validateSourceShortcut("")).toContain("Enter");
    expect(validateSourceShortcut("Y")).toContain("modifier");
    expect(validateSourceShortcut("Ctrl+Shift")).toContain("key");
    expect(validateSourceShortcut("Ctrl+Y+S")).toContain("one key");
    expect(validateSourceShortcut("Ctrl++Y")).toContain("format");
    expect(validateSourceShortcut("Ctrl+Shift+Yyo")).toContain("valid key");
    expect(validateSourceShortcut("Ctrl+F12")).toBe("");
    expect(validateSourceShortcut("Ctrl+PageDown")).toBe("");
    expect(validateSourceShortcut("Ctrl+Ctrl+Y")).toContain("repeat");
  });

  test("shows inline validation and only enables Apply for a valid change", async () => {
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Y"));
    expect(apply.disabled).toBe(true);

    input.value = "Yyo";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(status.textContent).toBe("Translated<o_lShortcutValidKey>");
    expect(apply.disabled).toBe(true);

    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(apply.disabled).toBe(false);
  });

  test("returns without the complete control set or commands API", () => {
    document.querySelector("#sourcePanelShortcutStatus")?.remove();
    expect(() => setupSourceShortcut()).not.toThrow();
    document.body.insertAdjacentHTML("beforeend", '<span id="sourcePanelShortcutStatus"></span>');
    (global.browser as any).commands = undefined;
    expect(() => setupSourceShortcut()).not.toThrow();
  });

  test("normalizes an unassigned command and platform-specific modifiers", async () => {
    for (const select of document.querySelectorAll<HTMLSelectElement>(
      "#sourcePanelShortcutModifier, #sourcePanelShortcutModifier2",
    )) {
      select.add(new Option("Command", "Command"));
      select.add(new Option("MacCtrl", "MacCtrl"));
    }
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
    global.browser.commands.getAll = vi.fn(() => Promise.resolve([{ name: "other-command" }]));
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    await vi.waitFor(() => expect(input.value).toBe(""));
    expect(
      document.querySelector<HTMLOptionElement>(
        "#sourcePanelShortcutModifier option[value='Command']",
      )!.hidden,
    ).toBe(true);
    expect(document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier")!.value).toBe(
      "Ctrl",
    );
    expect(document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier2")!.value).toBe(
      "",
    );
  });

  test("keeps Mac modifiers available and clears duplicate modifier choices", async () => {
    for (const select of document.querySelectorAll<HTMLSelectElement>(
      "#sourcePanelShortcutModifier, #sourcePanelShortcutModifier2",
    )) {
      select.add(new Option("Command", "Command"));
    }
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    setupSourceShortcut();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!.value).toBe("Y"),
    );
    const first = document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier")!;
    const second = document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier2")!;
    second.value = "Command";
    first.value = "Command";
    first.dispatchEvent(new Event("change"));
    expect(second.value).toBe("");
    expect(first.querySelector<HTMLOptionElement>("option[value='Command']")!.hidden).toBe(false);
  });

  test("applies with Enter, reports success, and restores the saved value with Escape", async () => {
    global.browser.commands.getAll = vi
      .fn()
      .mockResolvedValueOnce([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }])
      .mockResolvedValue([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+S" }]);
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Y"));
    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(status.textContent).toBe("Translated<o_lShortcutUpdated>"));

    input.value = "A";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(input.value).toBe("S");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  });

  test("contains invalid apply attempts and reset, update, and initial-load failures", async () => {
    global.browser.commands.getAll = vi.fn(() => Promise.reject(new Error("load failed")));
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(status.textContent).toContain("load failed"));
    input.value = "bad-key";
    apply.dispatchEvent(new MouseEvent("click"));
    expect(global.browser.commands.update).not.toHaveBeenCalled();

    global.browser.commands.getAll = vi.fn(() =>
      Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }]),
    );
    global.browser.commands.update = vi.fn(() => Promise.reject(new Error("update failed")));
    global.browser.commands.reset = vi.fn(() => Promise.reject(new Error("reset failed")));
    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    apply.dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() => expect(status.textContent).toContain("update failed"));
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    await vi.waitFor(() => expect(status.textContent).toContain("reset failed"));
  });

  test("contains synchronous command API failures and non-promise results", async () => {
    global.browser.commands.update = vi.fn(() => {
      throw new Error("synchronous update failure");
    });
    global.browser.commands.reset = vi.fn(() => undefined as never);
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Y"));

    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!.click();
    await vi.waitFor(() => expect(status.textContent).toContain("synchronous update failure"));

    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Translated<o_lShortcutReset>"));
  });

  test("uses English fallbacks when localized shortcut copy is unavailable", async () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    (global.browser as any).commands = {
      getAll: vi.fn(() =>
        Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }]),
      ),
    };
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Y"));
    input.value = "bad-key";
    input.dispatchEvent(new InputEvent("input"));
    expect(status.textContent).toContain("Choose a valid key");
    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    expect(status.textContent).toBe("Ready to apply.");
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!.click();
    expect(status.textContent).toContain("does not support changing shortcuts");
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    expect(status.textContent).toContain("does not support resetting shortcuts");

    const commands = global.browser.commands as any;
    commands.update = vi.fn(() => Promise.resolve());
    commands.getAll = vi.fn(() =>
      Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+Y" }]),
    );
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!.click();
    await vi.waitFor(() => expect(status.textContent).toContain("browser did not accept"));

    input.value = "T";
    input.dispatchEvent(new InputEvent("input"));
    commands.getAll = vi.fn(() =>
      Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+T" }]),
    );
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Shortcut updated."));

    commands.reset = vi.fn(() => Promise.resolve());
    commands.getAll = vi.fn(() => Promise.resolve([]));
    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Shortcut reset."));
  });
});
