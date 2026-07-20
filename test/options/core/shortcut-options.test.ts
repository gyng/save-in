// @vitest-environment jsdom
import { setupShortcutOptions } from "../../../src/options/core/shortcut-options.ts";
import { CLICK_GESTURES, parseClickToSaveBindings } from "../../../src/shared/click-gesture.ts";

const change = (element: Element) => element.dispatchEvent(new Event("change", { bubbles: true }));
const input = (element: Element) =>
  element.dispatchEvent(new InputEvent("input", { bubbles: true }));

describe("shortcut option controller", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("tolerates an options document without shortcut controls", () => {
    expect(() => setupShortcutOptions()).not.toThrow();
    document.dispatchEvent(new Event("options-restored"));
  });

  test("enables notification duration only while a notification is selected", () => {
    document.body.innerHTML = `<label class="notification-timing">
        <input type="hidden" id="notifyDuration" value="7000">
        <input type="number" id="notifyDurationSeconds" data-runtime-control="true">
      </label>
      <input type="checkbox" id="notifyOnSuccess">
      <input type="checkbox" id="notifyOnFailure">`;
    setupShortcutOptions();
    const duration = document.querySelector<HTMLInputElement>("#notifyDuration")!;
    const seconds = document.querySelector<HTMLInputElement>("#notifyDurationSeconds")!;
    const success = document.querySelector<HTMLInputElement>("#notifyOnSuccess")!;
    expect(duration.disabled).toBe(true);
    expect(seconds.disabled).toBe(true);
    expect(seconds.value).toBe("7");
    expect(duration.closest("label")!.classList).toContain("is-disabled");

    success.checked = true;
    change(success);
    expect(duration.disabled).toBe(false);
    expect(seconds.disabled).toBe(false);
    expect(duration.closest("label")!.classList).not.toContain("is-disabled");
    const saved = vi.fn();
    duration.addEventListener("change", saved);
    seconds.value = "2.5";
    change(seconds);
    expect(duration.value).toBe("2500");
    expect(saved).toHaveBeenCalledOnce();
    duration.value = "8000";
    document.dispatchEvent(new Event("options-restored"));
    expect(seconds.value).toBe("8");
  });

  test("contains invalid notification seconds and legacy duration-only markup", () => {
    document.body.innerHTML = `<label class="notification-timing">
        <input type="hidden" id="notifyDuration" value="bad">
        <input type="number" id="notifyDurationSeconds" data-runtime-control="true">
      </label>
      <input type="checkbox" id="notifyOnSuccess" checked>`;
    const seconds = document.querySelector<HTMLInputElement>("#notifyDurationSeconds")!;
    setupShortcutOptions();
    expect(seconds.value).toBe("");
    seconds.value = "-1";
    change(seconds);
    expect(document.querySelector<HTMLInputElement>("#notifyDuration")!.value).toBe("bad");

    document.body.innerHTML = `<label class="notification-timing">
        <input id="notifyDuration" value="7000">
      </label>`;
    expect(() => setupShortcutOptions()).not.toThrow();
    expect(document.querySelector(".notification-timing")?.classList).toContain("is-disabled");

    document.body.innerHTML = `<label class="notification-timing">
        <input type="number" id="notifyDurationSeconds" value="3">
      </label>`;
    setupShortcutOptions();
    const secondsOnly = document.querySelector<HTMLInputElement>("#notifyDurationSeconds")!;
    change(secondsOnly);
    expect(secondsOnly.disabled).toBe(true);
  });

  test("updates every shortcut format preview and falls back for unknown values", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<select id="shortcutType">
        <option>HTML_REDIRECT</option><option>MAC</option><option>MAC_WEBLOC</option>
        <option>WINDOWS</option><option>FREEDESKTOP</option><option>UNKNOWN</option>
      </select>
      <span id="shortcut-format-preview"></span>
      <input type="checkbox" id="shortcutMedia">`;
    setupShortcutOptions();
    const type = document.querySelector<HTMLSelectElement>("#shortcutType")!;
    const preview = document.querySelector("#shortcut-format-preview")!;
    const expected = new Map([
      ["HTML_REDIRECT", "Works in any browser"],
      ["MAC", "Legacy internet shortcut"],
      ["MAC_WEBLOC", "Native macOS shortcut"],
      ["WINDOWS", "Windows internet shortcut"],
      ["FREEDESKTOP", "Linux desktop shortcut"],
    ]);
    for (const [value, meaning] of expected) {
      type.value = value;
      change(type);
      expect(preview.textContent).toContain(meaning);
    }
    type.value = "UNKNOWN";
    change(document.querySelector("#shortcutMedia")!);
    expect(preview.textContent).toBe("page.txt");
  });

  test("normalizes duplicate modifiers and applies and resets the gesture", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="Alt">
      <input id="contentClickToSaveButton" value="RIGHT_CLICK">
      <select id="clickToSaveModifier"><option></option><option selected>Alt</option><option>Ctrl</option></select>
      <select id="clickToSaveModifier2"><option></option><option selected>Alt</option><option>Shift</option></select>
      <select id="clickToSaveButton"><option value="left-click">Left</option><option value="right-click">Right</option></select>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>
      <span id="clickToSaveStatus"></span><div id="click-to-save-warning"></div>`;
    setupShortcutOptions();
    const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier")!;
    const modifier2 = document.querySelector<HTMLSelectElement>("#clickToSaveModifier2")!;
    const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    const apply = document.querySelector<HTMLButtonElement>("#clickToSaveApply")!;
    const status = document.querySelector("#clickToSaveStatus")!;
    expect(modifier2.value).toBe("");

    modifier.value = "Ctrl";
    modifier2.value = "Shift";
    button.value = "left-click";
    change(modifier);
    expect(apply.disabled).toBe(false);
    expect(status.textContent).toBe("Ready to apply.");
    apply.click();
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe(
      "Ctrl+Shift",
    );
    expect(status.textContent).toBe("Shortcut updated.");

    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe("Alt");
    expect(status.textContent).toBe("Shortcut reset.");
  });

  test("shows the unsafe left-click warning only for an enabled modifier-free gesture", () => {
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option>Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton"><option value="left-click">Left</option><option value="right-click">Right</option></select>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>
      <div id="click-to-save-warning" hidden></div>`;
    setupShortcutOptions();
    const enabled = document.querySelector<HTMLInputElement>("#contentClickToSave")!;
    const warning = document.querySelector<HTMLElement>("#click-to-save-warning")!;
    expect(warning.hidden).toBe(false);
    enabled.checked = false;
    change(enabled);
    expect(warning.hidden).toBe(true);
    const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    button.value = "right-click";
    change(button);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
  });

  test("adds distinct gestures and prevents ambiguous single and double left bindings", () => {
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="Alt">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="left-click">Left</option><option value="middle-click">Middle</option>
        <option value="double-left-click">Double left</option>
      </select>
      <div id="clickToSaveAdditionalBindings"></div>
      <button id="clickToSaveAdd"></button><button id="clickToSaveApply"></button>
      <button id="clickToSaveReset"></button><span id="clickToSaveStatus"></span>
      <div id="click-to-save-warning" hidden></div><div id="click-to-save-double-warning" hidden></div>`;
    setupShortcutOptions();

    const primary = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    expect(
      primary.querySelector<HTMLOptionElement>('option[value="double-left-click"]')?.disabled,
    ).toBe(true);
    document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!.click();
    expect(document.querySelectorAll(".click-to-save-binding")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();

    expect(
      parseClickToSaveBindings(
        document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!.value,
      ),
    ).toEqual([
      { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
    ]);

    document.querySelector<HTMLButtonElement>(".click-to-save-binding button")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    expect(document.querySelectorAll(".click-to-save-binding")).toHaveLength(0);
    expect(
      parseClickToSaveBindings(
        document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!.value,
      ),
    ).toEqual([{ gesture: CLICK_GESTURES.LEFT, combo: "Alt" }]);
  });

  test("preserves a legacy combo and falls back when the stored mouse button is absent", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input id="contentClickToSaveCombo" value="90">
      <select id="clickToSaveModifier"><option></option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton"><option value="left-click">Left</option></select>`;
    setupShortcutOptions();
    const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier")!;
    expect(modifier.value).toBe("90");
    expect(modifier.selectedOptions[0]!.textContent).toBe("Legacy value: 90");
    expect(document.querySelector<HTMLSelectElement>("#clickToSaveButton")!.value).toBe(
      "left-click",
    );
    document.querySelector<HTMLSelectElement>("#clickToSaveButton")!.value = "";
    expect(() =>
      change(document.querySelector<HTMLSelectElement>("#clickToSaveButton")!),
    ).not.toThrow();
  });

  test("contains apply and reset actions when required controls are missing", () => {
    document.body.innerHTML = `<button id="clickToSaveApply"></button>
      <button id="clickToSaveReset"></button><button id="clickToSaveAdd"></button>`;
    setupShortcutOptions();
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!.click();
  });

  test("marks invalid access keys and clears the warning after correction", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input id="keyRoot" value="ab"><input id="keyLastUsed" value="7">
      <span id="access-key-status"></span>`;
    setupShortcutOptions();
    const root = document.querySelector<HTMLInputElement>("#keyRoot")!;
    expect(root.hasAttribute("aria-invalid")).toBe(true);
    expect(document.querySelector("#access-key-status")!.textContent).toContain(
      "Use one letter or number",
    );
    root.value = "Z";
    input(root);
    expect(root.hasAttribute("aria-invalid")).toBe(false);
    expect(document.querySelector("#access-key-status")!.textContent).toBe("");
  });
});
