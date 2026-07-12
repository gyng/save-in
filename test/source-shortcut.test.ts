import { setupSourceShortcut, validateSourceShortcut } from "../src/options/source-shortcut.ts";

describe("Page Sources shortcut control", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="sourcePanelShortcut">
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

  test("loads and updates the browser-owned shortcut", async () => {
    setupSourceShortcut();
    await vi.waitFor(() =>
      expect((document.querySelector("#sourcePanelShortcut") as HTMLInputElement).value).toBe(
        "Ctrl+Shift+Y",
      ),
    );
    const input = document.querySelector("#sourcePanelShortcut") as HTMLInputElement;
    input.value = "Alt+Shift+S";
    input.dispatchEvent(new InputEvent("input"));
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

  test("validates a modifier plus one key", () => {
    expect(validateSourceShortcut("Ctrl+Shift+Y")).toBe("");
    expect(validateSourceShortcut("Alt+S")).toBe("");
    expect(validateSourceShortcut("")).toContain("Enter");
    expect(validateSourceShortcut("Y")).toContain("modifier");
    expect(validateSourceShortcut("Ctrl+Shift")).toContain("key");
    expect(validateSourceShortcut("Ctrl+Y+S")).toContain("one key");
    expect(validateSourceShortcut("Ctrl++Y")).toContain("format");
  });

  test("shows inline validation and only enables Apply for a valid change", async () => {
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcut")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("Ctrl+Shift+Y"));
    expect(apply.disabled).toBe(true);

    input.value = "Y";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(status.textContent).toContain("modifier");
    expect(apply.disabled).toBe(true);

    input.value = "Alt+S";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(apply.disabled).toBe(false);
  });
});
