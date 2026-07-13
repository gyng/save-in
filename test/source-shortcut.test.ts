import { setupSourceShortcut, validateSourceShortcut } from "../src/options/source-shortcut.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Page Sources has an ergonomic cross-platform default shortcut", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  expect(manifest.commands["toggle-source-panel"].suggested_key).toEqual({
    default: "Ctrl+Shift+G",
    mac: "Command+Shift+G",
  });
});

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
        Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+G" }]),
      ),
      update: vi.fn(() => Promise.resolve()),
      reset: vi.fn(() => Promise.resolve()),
    };
  });

  test("loads and updates the browser-owned shortcut", async () => {
    setupSourceShortcut();
    await vi.waitFor(() =>
      expect((document.querySelector("#sourcePanelShortcutKey") as HTMLInputElement).value).toBe(
        "G",
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
        Promise.resolve([{ name: "toggle-source-panel", shortcut: "Ctrl+Shift+G" }]),
      ),
    };
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("G"));

    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    apply.click();
    expect(status.textContent).toContain("does not support changing shortcuts");
    expect(apply.disabled).toBe(false);

    document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset")!.click();
    expect(status.textContent).toContain("does not support resetting shortcuts");
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
  });

  test("shows inline validation and only enables Apply for a valid change", async () => {
    setupSourceShortcut();
    const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey")!;
    const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply")!;
    const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus")!;
    await vi.waitFor(() => expect(input.value).toBe("G"));
    expect(apply.disabled).toBe(true);

    input.value = "Yyo";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(status.textContent).toContain("valid key");
    expect(apply.disabled).toBe(true);

    input.value = "S";
    input.dispatchEvent(new InputEvent("input"));
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(apply.disabled).toBe(false);
  });
});
