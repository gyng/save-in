// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { setupCheckboxRows } from "../src/options/checkbox-rows.ts";
import { setupShortcutOptions } from "../src/options/shortcut-options.ts";
import { setupSettingsTransfer } from "../src/options/settings-transfer.ts";
import { parseCounterValue } from "../src/options/counter-panel.ts";
import { MESSAGE_TYPES } from "../src/shared/constants.ts";
import type { ApplyConfigResponse } from "../src/shared/message-protocol.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("shortcut option guidance", () => {
  const clickShortcutMarkup = (combo = "Ctrl+Shift", storedButton = "RIGHT_CLICK") => `
    <input type="checkbox" id="contentClickToSave" checked>
    <input id="contentClickToSaveCombo" value="${combo}">
    <input id="contentClickToSaveButton" value="${storedButton}">
    <select id="clickToSaveModifier">
      <option value=""></option><option value="Alt">Alt</option><option value="Ctrl">Ctrl</option>
    </select>
    <select id="clickToSaveModifier2">
      <option value=""></option><option value="Shift">Shift</option>
    </select>
    <select id="clickToSaveButton">
      <option value="LEFT_CLICK">left</option><option value="RIGHT_CLICK">right</option>
    </select>
    <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>
    <span id="clickToSaveStatus"></span><div id="click-to-save-warning" hidden></div>`;

  test("warns without blocking mouse-only left click and previews shortcut formats", () => {
    document.body.innerHTML = `
      <input type="checkbox" id="shortcutMedia" checked>
      <input type="checkbox" id="shortcutLink"><input type="checkbox" id="shortcutPage">
      <input type="checkbox" id="shortcutTab">
      <select id="shortcutType"><option value="MAC_WEBLOC" selected>webloc</option></select>
      <span id="shortcut-format-preview"></span>
      <input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveCombo" value="Ctrl+Shift">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option value=""></option><option value="Ctrl">Ctrl</option></select>
      <select id="clickToSaveModifier2"><option value=""></option><option value="Shift">Shift</option></select>
      <select id="clickToSaveButton"><option value="LEFT_CLICK">left</option><option value="MIDDLE_CLICK">middle</option></select>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>
      <span id="clickToSaveStatus"></span>
      <div id="click-to-save-warning" hidden></div>`;
    setupShortcutOptions();
    expect((document.querySelector("#clickToSaveModifier") as HTMLSelectElement).value).toBe(
      "Ctrl",
    );
    expect((document.querySelector("#clickToSaveModifier2") as HTMLSelectElement).value).toBe(
      "Shift",
    );
    expect(document.querySelector("#click-to-save-warning")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("#shortcut-format-preview")?.textContent).toContain(".webloc");
    expect((document.querySelector("#shortcutType") as HTMLSelectElement).disabled).toBe(false);
    const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    button.value = "MIDDLE_CLICK";
    button.dispatchEvent(new Event("change"));
    expect(document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveButton")!.value).toBe(
      "MIDDLE_CLICK",
    );
  });

  test("shows an unknown MV2 keycode as a preserved legacy value", () => {
    document.body.innerHTML = `
      <input id="contentClickToSaveCombo" value="90">
      <select id="clickToSaveModifier"><option value=""></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option value=""></option></select>`;
    setupShortcutOptions();
    const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier")!;
    expect(modifier.value).toBe("90");
    expect(modifier.selectedOptions[0]!.textContent).toBe("Translated<o_lShortcutLegacyValue>");
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe("90");
  });

  test("resynchronizes draft controls after an upgraded profile is restored", () => {
    document.body.innerHTML = clickShortcutMarkup("", "LEFT_CLICK");
    setupShortcutOptions();

    document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value = "Ctrl+Shift";
    document.querySelector<HTMLInputElement>("#contentClickToSaveButton")!.value = "RIGHT_CLICK";
    document.dispatchEvent(new Event("options-restored"));

    expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier")!.value).toBe("Ctrl");
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveModifier2")!.value).toBe("Shift");
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveButton")!.value).toBe(
      "RIGHT_CLICK",
    );
    expect(document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.disabled).toBe(true);
  });

  test("applying a modifier-only edit preserves the restored mouse button", () => {
    document.body.innerHTML = clickShortcutMarkup();
    setupShortcutOptions();
    document.dispatchEvent(new Event("options-restored"));

    const modifier2 = document.querySelector<HTMLSelectElement>("#clickToSaveModifier2")!;
    modifier2.value = "";
    modifier2.dispatchEvent(new Event("change"));
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();

    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe(
      "Ctrl",
    );
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveButton")!.value).toBe(
      "RIGHT_CLICK",
    );
  });
});

describe("checkbox rows", () => {
  test("wraps title content without moving help text", () => {
    document.body.innerHTML =
      '<label><input type="checkbox"> Enable <b>badge</b><span class="caption">Help</span></label>';
    setupCheckboxRows();
    expect(document.querySelector(".opt-title")?.textContent).toContain("Enable");
    expect(document.querySelector("label > .caption")?.textContent).toBe("Help");
  });
});

describe("settings transfer", () => {
  const applyResult = (
    rejected: Array<{ name: string; reason: string }> = [],
  ): ApplyConfigResponse => ({
    type: MESSAGE_TYPES.APPLY_CONFIG_RESULT,
    body: { version: 1, applied: {}, rejected },
  });
  const restore = () => vi.fn(async (): Promise<void> => {});

  const importMarkup = () => {
    document.body.innerHTML = '<button id="settings-import"></button>';
  };

  test("exports only schema-owned settings", async () => {
    document.body.innerHTML =
      '<button id="settings-export"></button><textarea id="export-target" hidden></textarea>';
    const getStored = vi.fn(async () => ({ enabled: true }));
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [{ name: "enabled" }] }),
      getStored,
      apply: vi.fn(),
      restore: restore(),
    });
    document.querySelector<HTMLButtonElement>("#settings-export")!.click();
    await vi.waitFor(() => expect(getStored).toHaveBeenCalledWith(["enabled"]));
    expect(document.querySelector<HTMLTextAreaElement>("#export-target")!.value).toBe(
      '{\n  "enabled": true\n}',
    );
  });

  test.each([
    ["schema", () => Promise.reject(new Error("schema unavailable")), vi.fn()],
    [
      "storage",
      () => Promise.resolve({ keys: [{ name: "enabled" }] }),
      vi.fn(() => Promise.reject(new Error("storage unavailable"))),
    ],
  ])("contains %s failures while exporting settings", async (_boundary, getSchema, getStored) => {
    document.body.innerHTML =
      '<button id="settings-export"></button><textarea id="export-target" hidden></textarea>';
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    setupSettingsTransfer({ getSchema, getStored, apply: vi.fn(), restore: restore() });

    document.querySelector<HTMLButtonElement>("#settings-export")!.click();

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Failed")));
    expect(document.querySelector<HTMLTextAreaElement>("#export-target")!.hidden).toBe(true);
  });

  test("imports a valid settings object and restores the controls", async () => {
    importMarkup();
    vi.spyOn(window, "prompt").mockReturnValue('{"enabled":true}');
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const apply = vi.fn().mockResolvedValue(applyResult());
    const restoreSettings = restore();
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [{ name: "enabled" }] }),
      getStored: vi.fn(),
      apply,
      restore: restoreSettings,
    });

    document.querySelector<HTMLButtonElement>("#settings-import")!.click();

    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith({ enabled: true }));
    expect(restoreSettings).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith("Settings loaded.");
  });

  test("reports partial imports after restoring the accepted values", async () => {
    importMarkup();
    vi.spyOn(window, "prompt").mockReturnValue('{"enabled":"yes","paths":"cats"}');
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const restoreSettings = restore();
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [] }),
      getStored: vi.fn(),
      apply: vi
        .fn()
        .mockResolvedValue(applyResult([{ name: "enabled", reason: "Expected a boolean" }])),
      restore: restoreSettings,
    });

    document.querySelector<HTMLButtonElement>("#settings-import")!.click();

    await vi.waitFor(() =>
      expect(alert).toHaveBeenCalledWith("Settings loaded with 1 rejected value(s)."),
    );
    expect(restoreSettings).toHaveBeenCalledOnce();
  });

  test("rejects imported arrays before applying them", async () => {
    importMarkup();
    vi.spyOn(window, "prompt").mockReturnValue("[]");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const apply = vi.fn();
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [] }),
      getStored: vi.fn(),
      apply,
      restore: restore(),
    });
    document.querySelector<HTMLButtonElement>("#settings-import")!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(apply).not.toHaveBeenCalled();
  });

  test.each([
    ["schema", () => Promise.reject(new Error("schema unavailable")), vi.fn()],
    [
      "apply",
      () => Promise.resolve({ keys: [] }),
      vi.fn(() => Promise.reject(new Error("apply unavailable"))),
    ],
  ])("contains %s failures while importing settings", async (_boundary, getSchema, apply) => {
    importMarkup();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue('{"enabled":true}');
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const restoreSettings = restore();
    setupSettingsTransfer({ getSchema, getStored: vi.fn(), apply, restore: restoreSettings });

    document.querySelector<HTMLButtonElement>("#settings-import")!.click();

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Failed")));
    expect(restoreSettings).not.toHaveBeenCalled();
    if (_boundary === "schema") expect(prompt).not.toHaveBeenCalled();
  });

  test("rejects protocol errors without restoring or reporting success", async () => {
    importMarkup();
    vi.spyOn(window, "prompt").mockReturnValue('{"enabled":true}');
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const restoreSettings = restore();
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [] }),
      getStored: vi.fn(),
      apply: vi.fn().mockResolvedValue({
        type: MESSAGE_TYPES.APPLY_CONFIG,
        body: { status: MESSAGE_TYPES.ERROR, error: "INTERNAL_ERROR" },
      } satisfies ApplyConfigResponse),
      restore: restoreSettings,
    });

    document.querySelector<HTMLButtonElement>("#settings-import")!.click();

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Failed")));
    expect(alert).not.toHaveBeenCalledWith("Settings loaded.");
    expect(restoreSettings).not.toHaveBeenCalled();
  });

  test("awaits restoration and contains restoration failures", async () => {
    importMarkup();
    vi.spyOn(window, "prompt").mockReturnValue('{"enabled":true}');
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const restoreSettings = vi.fn(() => Promise.reject(new Error("storage unavailable")));
    setupSettingsTransfer({
      getSchema: () => Promise.resolve({ keys: [] }),
      getStored: vi.fn(),
      apply: vi.fn().mockResolvedValue(applyResult()),
      restore: restoreSettings,
    });

    document.querySelector<HTMLButtonElement>("#settings-import")!.click();

    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Failed")));
    expect(restoreSettings).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalledWith("Settings loaded.");
  });
});

describe("counter control", () => {
  test("accepts only non-negative safe integers", () => {
    expect(parseCounterValue("42")).toBe(42);
    expect(parseCounterValue("0")).toBe(0);
    expect(parseCounterValue("-1")).toBeNull();
    expect(parseCounterValue("1.5")).toBeNull();
    expect(parseCounterValue("not a number")).toBeNull();
    expect(parseCounterValue("")).toBeNull();
  });
});
