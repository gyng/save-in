import { setupSourceShortcut } from "../src/options/source-shortcut.ts";

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
});
