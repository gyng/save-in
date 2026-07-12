import { beforeEach, describe, expect, test, vi } from "vitest";
import { setupCheckboxRows } from "../src/options/checkbox-rows.ts";
import { setupKeyComboPicker } from "../src/options/key-combo-picker.ts";
import { setupSettingsTransfer } from "../src/options/settings-transfer.ts";
import { parseCounterValue } from "../src/options/counter-panel.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("key combo picker", () => {
  test("filters choices and dispatches a change when one is chosen", () => {
    document.body.innerHTML = '<div class="combo-wrap"><input id="contentClickToSaveCombo"></div>';
    setupKeyComboPicker();
    const input = document.querySelector("input")!;
    const changed = vi.fn();
    input.addEventListener("change", changed);
    input.value = "sh";
    input.dispatchEvent(new Event("input"));
    const rows = document.querySelectorAll<HTMLLIElement>(".combo-dropdown li");
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.value).toBe("Shift");
    rows[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(input.value).toBe("Shift");
    expect(changed).toHaveBeenCalledOnce();
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
  test("exports only schema-owned settings", async () => {
    document.body.innerHTML =
      '<button id="settings-export"></button><textarea id="export-target" hidden></textarea>';
    const getStored = vi.fn(async () => ({ enabled: true }));
    setupSettingsTransfer({
      getSchema: Promise.resolve({ keys: [{ name: "enabled" }] }),
      getStored,
      apply: vi.fn(),
      restore: vi.fn(),
    });
    document.querySelector<HTMLButtonElement>("#settings-export")!.click();
    await vi.waitFor(() => expect(getStored).toHaveBeenCalledWith(["enabled"]));
    expect(document.querySelector<HTMLTextAreaElement>("#export-target")!.value).toBe(
      '{\n  "enabled": true\n}',
    );
  });

  test("rejects imported arrays before applying them", async () => {
    document.body.innerHTML = '<button id="settings-import"></button>';
    vi.spyOn(window, "prompt").mockReturnValue("[]");
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const apply = vi.fn();
    setupSettingsTransfer({
      getSchema: Promise.resolve({ keys: [] }),
      getStored: vi.fn(),
      apply,
      restore: vi.fn(),
    });
    document.querySelector<HTMLButtonElement>("#settings-import")!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalled());
    expect(apply).not.toHaveBeenCalled();
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
