import { SHORTCUT_EXTENSIONS, isShortcutType, type ShortcutType } from "../../shared/constants.ts";
import { getMessage } from "../../platform/localization.ts";
import {
  CLICK_GESTURES,
  LEGACY_CLICK_TO_SAVE_DISABLED_COMBO,
  clickBindingsConflict,
  gestureToClickType,
  isClickGesture,
  resolvePickerBindings,
  serializeClickToSaveBindings,
  trySerializeClickToSaveBindings,
  type ClickGesture,
  type ClickToSaveBinding,
} from "../../shared/click-gesture.ts";
import { CLICK_TYPES } from "../../shared/constants.ts";
import { readGestureBinding, storedClickToSaveBindings, writeGestureCombo } from "./gesture-row.ts";

const EFFECTIVE_ACCESS_KEY = /^[a-z0-9]$/i;
const FORMAT_GUIDANCE = {
  HTML_REDIRECT: { filename: "page.html", meaning: "o_lShortcutFormatAnyBrowser" },
  MAC: { filename: "page.url", meaning: "o_lShortcutFormatLegacyInternet" },
  MAC_WEBLOC: { filename: "page.webloc", meaning: "o_lShortcutFormatMac" },
  WINDOWS: { filename: "page.url", meaning: "o_lShortcutFormatWindows" },
  FREEDESKTOP: { filename: "page.desktop", meaning: "o_lShortcutFormatLinux" },
} as const satisfies Record<ShortcutType, { filename: string; meaning: string }>;

const shortcutFormatMeaning = (key: (typeof FORMAT_GUIDANCE)[ShortcutType]["meaning"]): string => {
  switch (key) {
    case "o_lShortcutFormatAnyBrowser":
      return getMessage("o_lShortcutFormatAnyBrowser") || "Works in any browser";
    case "o_lShortcutFormatLegacyInternet":
      return getMessage("o_lShortcutFormatLegacyInternet") || "Legacy internet shortcut";
    case "o_lShortcutFormatMac":
      return getMessage("o_lShortcutFormatMac") || "Native macOS shortcut";
    case "o_lShortcutFormatWindows":
      return getMessage("o_lShortcutFormatWindows") || "Windows internet shortcut";
    case "o_lShortcutFormatLinux":
      return getMessage("o_lShortcutFormatLinux") || "Linux desktop shortcut";
  }
};

export const setupShortcutOptions = () => {
  const notificationToggles = [
    "notifyOnSuccess",
    "notifyOnFailure",
    "notifyOnRuleMatch",
    "notifyOnLinkPreferred",
  ]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const notificationDuration = document.querySelector<HTMLInputElement>("#notifyDuration");
  const notificationDurationSeconds =
    document.querySelector<HTMLInputElement>("#notifyDurationSeconds");
  const showNotificationDuration = () => {
    if (!notificationDuration || !notificationDurationSeconds) return;
    const milliseconds = Number(notificationDuration.value);
    notificationDurationSeconds.value = Number.isFinite(milliseconds)
      ? String(milliseconds / 1000)
      : "";
  };
  const saveNotificationDuration = () => {
    if (!notificationDuration || !notificationDurationSeconds) return;
    const seconds = Number(notificationDurationSeconds.value);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    notificationDuration.value = String(Math.round(seconds * 1000));
    notificationDuration.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const syncNotifications = () => {
    const timingControl = notificationDurationSeconds ?? notificationDuration;
    if (timingControl) {
      const enabled = notificationToggles.some(({ checked }) => checked);
      if (notificationDuration) notificationDuration.disabled = !enabled;
      if (notificationDurationSeconds) notificationDurationSeconds.disabled = !enabled;
      timingControl.closest(".notification-timing")?.classList.toggle("is-disabled", !enabled);
    }
  };
  notificationToggles.forEach((toggle) => toggle.addEventListener("change", syncNotifications));
  notificationDurationSeconds?.addEventListener("change", saveNotificationDuration);

  const type = document.querySelector<HTMLSelectElement>("#shortcutType");
  const preview = document.querySelector<HTMLElement>("#shortcut-format-preview");
  const toggles = ["shortcutMedia", "shortcutLink", "shortcutPage", "shortcutTab"]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const syncFormat = () => {
    if (!type) return;
    const shortcutType = isShortcutType(type.value) ? type.value : null;
    const extension = shortcutType ? SHORTCUT_EXTENSIONS[shortcutType] : "";
    const guidance = shortcutType ? FORMAT_GUIDANCE[shortcutType] : undefined;
    if (preview) {
      preview.textContent = guidance
        ? `${guidance.filename} · ${shortcutFormatMeaning(guidance.meaning)}`
        : `page${extension || ".txt"}`;
    }
  };
  toggles.forEach((toggle) => toggle.addEventListener("change", syncFormat));
  type?.addEventListener("change", syncFormat);
  syncFormat();

  const bindingsField = document.querySelector<HTMLInputElement>("#contentClickToSaveBindings");
  const combo = document.querySelector<HTMLInputElement>("#contentClickToSaveCombo");
  const storedButton = document.querySelector<HTMLInputElement>("#contentClickToSaveButton");
  const modifier = document.querySelector<HTMLSelectElement>("#clickToSaveModifier");
  const modifier2 = document.querySelector<HTMLSelectElement>("#clickToSaveModifier2");
  const button = document.querySelector<HTMLSelectElement>("#clickToSaveButton");
  const apply = document.querySelector<HTMLButtonElement>("#clickToSaveApply");
  const reset = document.querySelector<HTMLButtonElement>("#clickToSaveReset");
  const status = document.querySelector<HTMLElement>("#clickToSaveStatus");
  const clickToSave = document.querySelector<HTMLInputElement>("#contentClickToSave");
  const pickerGesture = document.querySelector<HTMLInputElement>("#contentPickerGesture");
  const pickerBindingsField = document.querySelector<HTMLInputElement>("#contentPickerBindings");
  const warning = document.querySelector<HTMLElement>("#click-to-save-warning");
  const doubleWarning = document.querySelector<HTMLElement>("#click-to-save-double-warning");
  const longWarning = document.querySelector<HTMLElement>("#click-to-save-long-warning");
  const longTiming = document.querySelector<HTMLElement>("#clickToSaveLongPressTiming");
  const longDuration = document.querySelector<HTMLInputElement>("#contentClickToSaveLongPressMs");
  const additional = document.querySelector<HTMLElement>("#clickToSaveAdditionalBindings");
  const add = document.querySelector<HTMLButtonElement>("#clickToSaveAdd");
  const controlsFieldset = document.querySelector<HTMLElement>(".click-to-save-controls");
  type BindingControls = {
    row: HTMLElement | null;
    modifier: HTMLSelectElement;
    modifier2: HTMLSelectElement;
    gesture: HTMLSelectElement;
    remove: HTMLButtonElement | null;
  };
  const extraControls: BindingControls[] = [];
  const primaryControls =
    modifier && modifier2 && button
      ? { row: null, modifier, modifier2, gesture: button, remove: null }
      : null;
  const gestureLabelKeys: Record<ClickGesture, string> = {
    [CLICK_GESTURES.LEFT]: "o_cKeyboardShortcutModifierLeftClick",
    [CLICK_GESTURES.MIDDLE]: "o_cKeyboardShortcutModifierMiddleClick",
    [CLICK_GESTURES.RIGHT]: "o_cKeyboardShortcutModifierRightClick",
    [CLICK_GESTURES.BACK]: "o_cKeyboardShortcutModifierBackClick",
    [CLICK_GESTURES.FORWARD]: "o_cKeyboardShortcutModifierForwardClick",
    [CLICK_GESTURES.DOUBLE_LEFT]: "o_cKeyboardShortcutModifierDoubleLeftClick",
    [CLICK_GESTURES.LONG_LEFT]: "o_cKeyboardShortcutModifierLongLeftClick",
  };
  // Added rows must list options in the same order as the static row and the
  // Page Sources shortcut group: the second modifier leads with Shift there.
  const primaryModifierOptions = [
    ["", "html_none"],
    ["Alt", "html_altOption"],
    ["Ctrl", "html_ctrl"],
    ["Shift", "html_shift"],
    ["Meta", "html_commandWindowsKey"],
  ] as const;
  const secondModifierOptions = [
    ["", "html_none"],
    ["Shift", "html_shift"],
    ["Alt", "html_altOption"],
    ["Ctrl", "html_ctrl"],
    ["Meta", "html_commandWindowsKey"],
  ] as const;
  const allControls = (): BindingControls[] =>
    primaryControls ? [primaryControls, ...extraControls] : [];
  const selectedBindings = (): ClickToSaveBinding[] => allControls().map(readGestureBinding);
  let baselineSerialized = "";
  // Added rows keep their historical default — the first unused gesture with
  // Alt — and only then reuse a gesture with other keys.
  const ADDED_ROW_COMBOS = ["Alt", "Ctrl", "Shift", "Meta", "Ctrl+Shift", "Alt+Shift"] as const;
  const nextBinding = (): ClickToSaveBinding | null => {
    const bindings = selectedBindings();
    for (const addedCombo of ADDED_ROW_COMBOS) {
      for (const gesture of Object.values(CLICK_GESTURES)) {
        const candidate = { gesture, combo: addedCombo };
        if (trySerializeClickToSaveBindings([...bindings, candidate]) !== null) return candidate;
      }
    }
    return null;
  };
  const syncGestureWarning = () => {
    const bindings = selectedBindings();
    if (warning) {
      warning.hidden =
        !clickToSave?.checked ||
        !bindings.some(
          ({ combo: selectedCombo, gesture }) =>
            !String(selectedCombo) && gesture === CLICK_GESTURES.LEFT,
        );
    }
    if (doubleWarning) {
      doubleWarning.hidden =
        !clickToSave?.checked ||
        !bindings.some(({ gesture }) => gesture === CLICK_GESTURES.DOUBLE_LEFT);
    }
    const hasLongPress = bindings.some(({ gesture }) => gesture === CLICK_GESTURES.LONG_LEFT);
    if (longWarning) longWarning.hidden = !clickToSave?.checked || !hasLongPress;
    // The folder picker's own gesture uses the same hold duration, so the
    // field stays available while either feature has a long left click.
    const pickerLongPress = resolvePickerBindings(pickerBindingsField?.value).some(
      ({ gesture }) => gesture === CLICK_GESTURES.LONG_LEFT,
    );
    if (longTiming) longTiming.hidden = !hasLongPress && !pickerLongPress;
    if (longDuration)
      longDuration.disabled = !(
        (clickToSave?.checked === true && hasLongPress) ||
        (pickerGesture?.checked === true && pickerLongPress)
      );
  };
  const syncClickControls = () => {
    if (!primaryControls) return;
    const controls = allControls();
    const bindings = selectedBindings();
    controls.forEach((current) => {
      [...current.gesture.options].forEach((option) => {
        const value = option.value;
        const next =
          isClickGesture(value) &&
          value !== current.gesture.value &&
          controls.some(
            (other) =>
              other !== current &&
              clickBindingsConflict(
                { gesture: value, combo: readGestureBinding(current).combo },
                readGestureBinding(other),
              ),
          );
        // Only touch the option when its state actually flips: a redundant
        // write to a select whose native popup happens to be open repaints
        // (and can dismiss) it for no reason.
        if (option.disabled !== next) option.disabled = next;
      });
    });
    const enabled = clickToSave?.checked === true;
    controls.forEach((current) => {
      current.modifier.disabled = !enabled;
      current.modifier2.disabled = !enabled;
      current.gesture.disabled = !enabled;
      if (current.remove) current.remove.disabled = !enabled;
    });
    // Dim the group via a class the controller owns, not a CSS
    // :has(select:disabled): a :has() keyed on control state re-invalidates
    // the subtree as a native select popup gains and loses focus, which makes
    // the popup flicker and can leave it open on an outside click.
    controlsFieldset?.classList.toggle("is-controls-disabled", !enabled);
    // A conflicting selection is normally unreachable (conflicting options are
    // disabled above), but this handler must never die on one: surface the
    // conflict and keep Apply disabled instead of throwing.
    const serialized = trySerializeClickToSaveBindings(bindings);
    const changed = serialized !== null && serialized !== baselineSerialized;
    if (apply) apply.disabled = !enabled || !changed;
    if (reset) reset.disabled = !enabled;
    if (add) add.disabled = !enabled || nextBinding() === null;
    if (status)
      status.textContent =
        serialized === null
          ? getMessage("o_lClickToSaveDuplicateBinding") ||
            "Two click gestures use the same click and keys. Change one of them."
          : changed
            ? getMessage("o_lShortcutReady") || "Ready to apply."
            : "";
    syncGestureWarning();
  };
  const option = (value: string, labelKey: string): HTMLOptionElement => {
    const result = document.createElement("option");
    result.value = value;
    result.textContent = getMessage(labelKey) || value || "None";
    return result;
  };
  const labeledSelect = (
    labelKey: string,
    options: ReadonlyArray<readonly [string, string]>,
  ): { label: HTMLLabelElement; select: HTMLSelectElement } => {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.className = "shortcut-control-label";
    caption.textContent = getMessage(labelKey) || labelKey;
    const select = document.createElement("select");
    select.dataset.runtimeControl = "true";
    select.append(...options.map(([value, key]) => option(value, key)));
    label.append(caption, select);
    return { label, select };
  };
  // Every added row repeats the same three control labels, so assistive tech
  // needs the row itself to carry the distinguishing context. The primary
  // controls are gesture 1; added rows count from 2 and renumber on removal.
  const renumberBindingRows = (): void => {
    extraControls.forEach((controls, index) => {
      const number = index + 2;
      controls.row?.setAttribute(
        "aria-label",
        getMessage("o_lClickGestureGroup", String(number)) || `Click gesture ${number}`,
      );
      controls.remove?.setAttribute(
        "aria-label",
        getMessage("o_lRemoveClickGestureNumbered", String(number)) ||
          `Remove click gesture ${number}`,
      );
    });
  };
  const addBindingRow = (binding: ClickToSaveBinding): void => {
    if (!additional) return;
    const row = document.createElement("div");
    row.className = "click-to-save-binding";
    row.setAttribute("role", "group");
    const first = labeledSelect("html_primaryModifier", primaryModifierOptions);
    const second = labeledSelect("html_secondModifier", secondModifierOptions);
    const gesture = labeledSelect(
      "o_lClickToSaveButton",
      Object.values(CLICK_GESTURES).map((value) => [value, gestureLabelKeys[value]] as const),
    );
    [first.select, second.select, gesture.select].forEach((select) =>
      select.setAttribute("aria-describedby", "clickToSaveStatus"),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = getMessage("o_bRemoveClickToSaveBinding") || "Remove gesture";
    const controls: BindingControls = {
      row,
      modifier: first.select,
      modifier2: second.select,
      gesture: gesture.select,
      remove,
    };
    writeGestureCombo(controls, binding.combo);
    controls.gesture.value = binding.gesture;
    [controls.modifier, controls.modifier2, controls.gesture].forEach((select) =>
      select.addEventListener("change", syncClickControls),
    );
    remove.addEventListener("click", () => {
      const index = extraControls.indexOf(controls);
      if (index >= 0) extraControls.splice(index, 1);
      row.remove();
      renumberBindingRows();
      syncClickControls();
    });
    row.append(first.label, second.label, gesture.label, remove);
    additional.append(row);
    extraControls.push(controls);
    renumberBindingRows();
  };
  const clearAdditional = (): void => {
    extraControls.splice(0);
    additional?.replaceChildren();
  };
  const showClickCombo = () => {
    if (!combo || !primaryControls) return;
    const bindings = storedClickToSaveBindings();
    clearAdditional();
    const [first, ...remaining] = bindings;
    writeGestureCombo(primaryControls, first.combo);
    primaryControls.gesture.value = first.gesture;
    remaining.forEach(addBindingRow);
    baselineSerialized = serializeClickToSaveBindings(bindings);
    syncClickControls();
  };
  [button, modifier, modifier2].forEach((control) =>
    control?.addEventListener("change", syncClickControls),
  );
  clickToSave?.addEventListener("change", syncClickControls);
  pickerGesture?.addEventListener("change", syncGestureWarning);
  pickerBindingsField?.addEventListener("change", syncGestureWarning);
  const applyGesture = () => {
    if (!bindingsField || !combo || !storedButton) return;
    const bindings = selectedBindings();
    const serialized = trySerializeClickToSaveBindings(bindings);
    if (serialized === null) {
      // Unreachable through the UI (conflicting options are disabled), but a
      // conflict must render as state, not as an uncaught handler exception.
      syncClickControls();
      return;
    }
    bindingsField.value = serialized;
    bindingsField.dispatchEvent(new Event("change", { bubbles: true }));
    let mirrored = false;
    for (const binding of bindings) {
      const legacyButton = gestureToClickType(binding.gesture);
      if (legacyButton === null) continue;
      combo.value = String(binding.combo);
      storedButton.value = legacyButton;
      mirrored = true;
      break;
    }
    if (!mirrored) {
      // No selected binding is legacy-representable (e.g. double-left only).
      // Leaving the mirror untouched would keep a pre-update content script
      // saving on the previous gesture, so write the pair to the state a
      // legacy consumer treats as click-to-save off.
      combo.value = LEGACY_CLICK_TO_SAVE_DISABLED_COMBO;
      storedButton.value = CLICK_TYPES.LEFT_CLICK;
    }
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    storedButton.dispatchEvent(new Event("change", { bubbles: true }));
    baselineSerialized = serialized;
    syncClickControls();
    if (status)
      status.textContent = getMessage("o_lClickGesturesUpdated") || "Click gestures updated.";
  };
  apply?.addEventListener("click", applyGesture);
  add?.addEventListener("click", () => {
    const binding = nextBinding();
    if (!binding) return;
    addBindingRow(binding);
    syncClickControls();
  });
  reset?.addEventListener("click", () => {
    if (!primaryControls) return;
    clearAdditional();
    writeGestureCombo(primaryControls, "Alt");
    primaryControls.gesture.value = CLICK_GESTURES.LEFT;
    applyGesture();
    if (status)
      status.textContent =
        getMessage("o_lClickGesturesReset") || "Click gestures restored to the default.";
  });
  showClickCombo();

  const accessInputs = ["keyRoot", "keyLastUsed"]
    .map((id) => document.querySelector<HTMLInputElement>(`#${id}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const accessStatus = document.querySelector<HTMLElement>("#access-key-status");
  const validateAccessKeys = () => {
    const invalid = accessInputs.find(({ value }) => value && !EFFECTIVE_ACCESS_KEY.test(value));
    accessInputs.forEach((input) =>
      input.toggleAttribute(
        "aria-invalid",
        Boolean(input.value && !EFFECTIVE_ACCESS_KEY.test(input.value)),
      ),
    );
    if (accessStatus) {
      accessStatus.textContent = invalid
        ? getMessage("o_lAccessKeyInvalid") ||
          "Use one letter or number. Existing saved values remain supported until changed."
        : "";
    }
  };
  accessInputs.forEach((input) => input.addEventListener("input", validateAccessKeys));
  validateAccessKeys();

  document.addEventListener("options-restored", () => {
    showNotificationDuration();
    syncNotifications();
    syncFormat();
    showClickCombo();
    syncClickControls();
    validateAccessKeys();
  });
  showNotificationDuration();
  syncNotifications();
};
