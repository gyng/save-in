// @vitest-environment jsdom
import { setupShortcutOptions } from "../../../src/options/core/shortcut-options.ts";
import {
  CLICK_GESTURES,
  parseClickToSaveBindings,
  serializeClickToSaveBindings,
} from "../../../src/shared/click-gesture.ts";

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
    expect(status.textContent).toBe("Click gestures updated.");

    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
    expect(document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!.value).toBe("Alt");
    expect(status.textContent).toBe("Click gestures restored to the default.");
  });

  test("shows the unsafe left-click warning only for an enabled modifier-free gesture", () => {
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <fieldset class="click-to-save-controls">
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option>Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton"><option value="left-click">Left</option><option value="right-click">Right</option></select>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>
      <div id="click-to-save-warning" hidden></div></fieldset>`;
    setupShortcutOptions();
    const enabled = document.querySelector<HTMLInputElement>("#contentClickToSave")!;
    const warning = document.querySelector<HTMLElement>("#click-to-save-warning")!;
    const fieldset = document.querySelector<HTMLElement>(".click-to-save-controls")!;
    expect(warning.hidden).toBe(false);
    // The group's dimming rides a controller-owned class, not a
    // CSS :has(select:disabled) that would flicker native select popups.
    expect(fieldset.classList.contains("is-controls-disabled")).toBe(false);
    enabled.checked = false;
    change(enabled);
    expect(warning.hidden).toBe(true);
    expect(fieldset.classList.contains("is-controls-disabled")).toBe(true);
    const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    button.value = "right-click";
    change(button);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
  });

  test("replaces the current left gesture while preventing conflicts with other bindings", () => {
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
    ).toBe(false);
    primary.value = "double-left-click";
    change(primary);
    expect(primary.value).toBe("double-left-click");
    expect(primary.querySelector<HTMLOptionElement>('option[value="left-click"]')?.disabled).toBe(
      false,
    );

    document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!.click();
    expect(document.querySelectorAll(".click-to-save-binding")).toHaveLength(1);
    const additionalGesture = document.querySelectorAll<HTMLSelectElement>(
      ".click-to-save-binding select",
    )[2]!;
    expect(additionalGesture.value).toBe("middle-click");
    expect(
      additionalGesture.querySelector<HTMLOptionElement>('option[value="left-click"]')?.disabled,
    ).toBe(true);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();

    expect(
      parseClickToSaveBindings(
        document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!.value,
      ),
    ).toEqual([
      { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Alt" },
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
    ]);

    const remove = document.querySelector<HTMLButtonElement>(".click-to-save-binding button")!;
    remove.click();
    remove.dispatchEvent(new MouseEvent("click"));
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    expect(document.querySelectorAll(".click-to-save-binding")).toHaveLength(0);
    expect(
      parseClickToSaveBindings(
        document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!.value,
      ),
    ).toEqual([{ gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Alt" }]);
  });

  test("numbers added gesture rows for assistive tech and matches modifier order", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="Alt">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="left-click">Left</option><option value="middle-click">Middle</option>
        <option value="right-click">Right</option>
      </select>
      <div id="clickToSaveAdditionalBindings"></div>
      <button id="clickToSaveAdd"></button><button id="clickToSaveApply"></button>
      <button id="clickToSaveReset"></button><span id="clickToSaveStatus"></span>
      <div id="click-to-save-warning" hidden></div>`;
    setupShortcutOptions();

    const add = document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!;
    add.click();
    add.click();
    const rows = [...document.querySelectorAll<HTMLElement>(".click-to-save-binding")];
    expect(rows).toHaveLength(2);
    // The primary controls are gesture 1; added rows count from 2 and carry
    // the context every repeated per-row label lacks.
    expect(rows.map((row) => row.getAttribute("role"))).toEqual(["group", "group"]);
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Click gesture 2",
      "Click gesture 3",
    ]);
    expect(rows.map((row) => row.querySelector("button")?.getAttribute("aria-label"))).toEqual([
      "Remove click gesture 2",
      "Remove click gesture 3",
    ]);
    // Added rows list modifiers in the static row's order: the second
    // modifier leads with Shift, like the Page Sources shortcut group.
    const selects = rows[0]!.querySelectorAll("select");
    expect([...selects[0]!.options].map((option) => option.value)).toEqual([
      "",
      "Alt",
      "Ctrl",
      "Shift",
      "Meta",
    ]);
    expect([...selects[1]!.options].map((option) => option.value)).toEqual([
      "",
      "Shift",
      "Alt",
      "Ctrl",
      "Meta",
    ]);
    expect(selects[2]!.getAttribute("aria-describedby")).toBe("clickToSaveStatus");

    rows[0]!.querySelector("button")!.click();
    // The remaining row renumbers so its accessible context stays truthful.
    const remaining = document.querySelector<HTMLElement>(".click-to-save-binding")!;
    expect(remaining.getAttribute("aria-label")).toBe("Click gesture 2");
    expect(remaining.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Remove click gesture 2",
    );
  });

  test("allows long-left beside double-left and reveals its duration control", () => {
    const stored = serializeClickToSaveBindings([
      { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Alt" },
      { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Alt" },
    ]);
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value='${stored}'>
      <input id="contentClickToSaveCombo" value="999">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="left-click">Left</option><option value="double-left-click">Double</option>
        <option value="long-left-click">Long</option>
      </select>
      <div id="clickToSaveAdditionalBindings"></div>
      <div id="clickToSaveLongPressTiming" hidden><input id="contentClickToSaveLongPressMs" value="500"></div>
      <button id="clickToSaveAdd"></button><button id="clickToSaveApply"></button>
      <button id="clickToSaveReset"></button><span id="clickToSaveStatus"></span>
      <div id="click-to-save-double-warning" hidden></div>
      <div id="click-to-save-long-warning" hidden></div>`;
    setupShortcutOptions();

    const primary = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    const extra = document.querySelectorAll<HTMLSelectElement>(".click-to-save-binding select")[2]!;
    expect(primary.value).toBe("double-left-click");
    expect(extra.value).toBe("long-left-click");
    expect(document.querySelector<HTMLButtonElement>("#clickToSaveApply")?.disabled).toBe(true);
    expect(primary.querySelector<HTMLOptionElement>('option[value="left-click"]')?.disabled).toBe(
      true,
    );
    expect(document.querySelector<HTMLElement>("#clickToSaveLongPressTiming")?.hidden).toBe(false);
    expect(
      document.querySelector<HTMLInputElement>("#contentClickToSaveLongPressMs")?.disabled,
    ).toBe(false);
    expect(document.querySelector<HTMLElement>("#click-to-save-long-warning")?.hidden).toBe(false);

    document.querySelector<HTMLButtonElement>(".click-to-save-binding button")?.click();
    expect(document.querySelector<HTMLElement>("#clickToSaveLongPressTiming")?.hidden).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("#contentClickToSaveLongPressMs")?.disabled,
    ).toBe(true);
  });

  test("writes the disabled legacy mirror when no binding is legacy-representable", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="Alt">
      <input id="contentClickToSaveButton" value="RIGHT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="right-click">Right</option><option value="double-left-click">Double left</option>
      </select>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>`;
    setupShortcutOptions();

    const primary = document.querySelector<HTMLSelectElement>("#clickToSaveButton")!;
    primary.value = "double-left-click";
    change(primary);
    const combo = document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")!;
    const storedButton = document.querySelector<HTMLInputElement>("#contentClickToSaveButton")!;
    const comboSaved = vi.fn();
    const buttonSaved = vi.fn();
    combo.addEventListener("change", comboSaved);
    storedButton.addEventListener("change", buttonSaved);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();

    expect(
      parseClickToSaveBindings(
        document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!.value,
      ),
    ).toEqual([{ gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Alt" }]);
    // A pre-update content script ignores the bindings field, so leaving the
    // stale Alt/RIGHT_CLICK mirror would keep it saving on the old gesture.
    expect(combo.value).toBe("999");
    expect(storedButton.value).toBe("LEFT_CLICK");
    expect(comboSaved).toHaveBeenCalledOnce();
    expect(buttonSaved).toHaveBeenCalledOnce();
  });

  test("surfaces a conflicting selection instead of throwing from the change handler", () => {
    vi.mocked(browser.i18n.getMessage).mockReturnValue("");
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value="">
      <input id="contentClickToSaveCombo" value="Alt">
      <input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="left-click">Left</option><option value="middle-click">Middle</option>
      </select>
      <div id="clickToSaveAdditionalBindings"></div>
      <button id="clickToSaveAdd"></button><button id="clickToSaveApply"></button>
      <button id="clickToSaveReset"></button><span id="clickToSaveStatus"></span>`;
    setupShortcutOptions();

    document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!.click();
    const additionalGesture = document.querySelectorAll<HTMLSelectElement>(
      ".click-to-save-binding select",
    )[2]!;
    // Conflicting options are disabled in the UI, but a select's value can
    // still be forced (e.g. by future markup gaps); the handler must survive.
    additionalGesture.value = "left-click";
    expect(() => change(additionalGesture)).not.toThrow();

    const apply = document.querySelector<HTMLButtonElement>("#clickToSaveApply")!;
    expect(apply.disabled).toBe(true);
    expect(document.querySelector("#clickToSaveStatus")!.textContent).toBe(
      "Do not repeat keys or modifiers.",
    );
    // A disabled button swallows click(); force it so the handler's own
    // guard is what keeps a conflicting selection from being written.
    apply.disabled = false;
    const bindingsField = document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")!;
    expect(() => apply.click()).not.toThrow();
    expect(bindingsField.value).toBe("");
    expect(apply.disabled).toBe(true);
    expect(document.querySelector("#clickToSaveStatus")!.textContent).toBe(
      "Do not repeat keys or modifiers.",
    );
  });

  test("contains Add when every compatible gesture is already bound", () => {
    document.body.innerHTML = `<input type="checkbox" id="contentClickToSave" checked>
      <input id="contentClickToSaveBindings" value='${serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
        { gesture: CLICK_GESTURES.RIGHT, combo: "Alt" },
        { gesture: CLICK_GESTURES.BACK, combo: "Alt" },
        { gesture: CLICK_GESTURES.FORWARD, combo: "Alt" },
      ])}'>
      <input id="contentClickToSaveCombo" value="Alt"><input id="contentClickToSaveButton" value="LEFT_CLICK">
      <select id="clickToSaveModifier"><option></option><option value="Alt">Alt</option></select>
      <select id="clickToSaveModifier2"><option></option></select>
      <select id="clickToSaveButton">
        <option value="left-click">Left</option><option value="middle-click">Middle</option>
        <option value="right-click">Right</option><option value="back-click">Back</option>
        <option value="forward-click">Forward</option><option value="double-left-click">Double</option>
      </select>
      <div id="clickToSaveAdditionalBindings"></div><button id="clickToSaveAdd"></button>
      <button id="clickToSaveApply"></button><button id="clickToSaveReset"></button>`;
    setupShortcutOptions();

    const add = document.querySelector<HTMLButtonElement>("#clickToSaveAdd")!;
    expect(add.disabled).toBe(true);
    add.dispatchEvent(new MouseEvent("click"));
    expect(document.querySelectorAll(".click-to-save-binding")).toHaveLength(4);

    const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier")!;
    modifier.value = "";
    change(modifier);
    document.querySelector<HTMLButtonElement>("#clickToSaveApply")!.click();
    document.querySelector<HTMLButtonElement>("#clickToSaveReset")!.click();
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
