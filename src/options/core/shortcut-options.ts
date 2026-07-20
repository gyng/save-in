import { SHORTCUT_EXTENSIONS, isShortcutType, type ShortcutType } from "../../shared/constants.ts";
import { getMessage } from "../../platform/localization.ts";
import { isClickType } from "../../config/content-options.ts";
import {
  CLICK_GESTURES,
  gestureToClickType,
  isClickGesture,
  resolveClickToSaveBindings,
  serializeClickToSaveBindings,
  type ClickGesture,
  type ClickToSaveBinding,
} from "../../shared/click-gesture.ts";

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
  const warning = document.querySelector<HTMLElement>("#click-to-save-warning");
  const doubleWarning = document.querySelector<HTMLElement>("#click-to-save-double-warning");
  const additional = document.querySelector<HTMLElement>("#clickToSaveAdditionalBindings");
  const add = document.querySelector<HTMLButtonElement>("#clickToSaveAdd");
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
  };
  const modifierOptions = [
    ["", "html_none"],
    ["Alt", "html_altOption"],
    ["Ctrl", "html_ctrl"],
    ["Shift", "html_shift"],
    ["Meta", "html_commandWindowsKey"],
  ] as const;
  const allControls = (): BindingControls[] =>
    primaryControls ? [primaryControls, ...extraControls] : [];
  const writeCombo = (controls: BindingControls, value: string | number): void => {
    const text = String(value);
    const parts = text.split("+").filter(Boolean);
    const known = new Set(["Alt", "Ctrl", "Shift", "Meta"]);
    const unknown = parts.find((part) => !known.has(part));
    controls.modifier.querySelector("[data-legacy]")?.remove();
    if (unknown) {
      const option = document.createElement("option");
      option.value = text;
      option.textContent = getMessage("o_lShortcutLegacyValue", text) || `Legacy value: ${text}`;
      option.dataset.legacy = "true";
      controls.modifier.append(option);
      controls.modifier.value = text;
      controls.modifier2.value = "";
      return;
    }
    controls.modifier.value = parts[0] || "";
    controls.modifier2.value = parts[1] || "";
  };
  const readBinding = (controls: BindingControls): ClickToSaveBinding => {
    if (controls.modifier2.value === controls.modifier.value) controls.modifier2.value = "";
    return {
      gesture: isClickGesture(controls.gesture.value)
        ? controls.gesture.value
        : CLICK_GESTURES.LEFT,
      combo: [controls.modifier.value, controls.modifier2.value].filter(Boolean).join("+"),
    };
  };
  const selectedBindings = (): ClickToSaveBinding[] => allControls().map(readBinding);
  let baselineSerialized = "";
  const gestureConflicts = (gesture: ClickGesture, other: ClickGesture): boolean =>
    gesture === other ||
    (gesture === CLICK_GESTURES.LEFT && other === CLICK_GESTURES.DOUBLE_LEFT) ||
    (gesture === CLICK_GESTURES.DOUBLE_LEFT && other === CLICK_GESTURES.LEFT);
  const unusedGestures = (): ClickGesture[] => {
    const used = selectedBindings().map(({ gesture }) => gesture);
    return Object.values(CLICK_GESTURES).filter(
      (gesture) => !used.some((selected) => gestureConflicts(gesture, selected)),
    );
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
  };
  const syncClickControls = () => {
    if (!primaryControls) return;
    const controls = allControls();
    const bindings = selectedBindings();
    controls.forEach((current) => {
      [...current.gesture.options].forEach((option) => {
        if (!isClickGesture(option.value) || option.value === current.gesture.value) {
          option.disabled = false;
          return;
        }
        const optionGesture = option.value;
        option.disabled = controls.some((other) =>
          gestureConflicts(optionGesture, readBinding(other).gesture),
        );
      });
    });
    const enabled = clickToSave?.checked === true;
    controls.forEach((current) => {
      current.modifier.disabled = !enabled;
      current.modifier2.disabled = !enabled;
      current.gesture.disabled = !enabled;
      if (current.remove) current.remove.disabled = !enabled;
    });
    const serialized = serializeClickToSaveBindings(bindings);
    const changed = serialized !== baselineSerialized;
    if (apply) apply.disabled = !enabled || !changed;
    if (reset) reset.disabled = !enabled;
    if (add) add.disabled = !enabled || unusedGestures().length === 0;
    if (status)
      status.textContent = changed ? getMessage("o_lShortcutReady") || "Ready to apply." : "";
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
  const addBindingRow = (binding: ClickToSaveBinding): void => {
    if (!additional) return;
    const row = document.createElement("div");
    row.className = "click-to-save-binding";
    const first = labeledSelect("html_primaryModifier", modifierOptions);
    const second = labeledSelect("html_secondModifier", modifierOptions);
    const gesture = labeledSelect(
      "o_lClickToSaveButton",
      Object.values(CLICK_GESTURES).map((value) => [value, gestureLabelKeys[value]] as const),
    );
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = getMessage("externalRemoveApproval") || "Remove";
    const controls: BindingControls = {
      row,
      modifier: first.select,
      modifier2: second.select,
      gesture: gesture.select,
      remove,
    };
    writeCombo(controls, binding.combo);
    controls.gesture.value = binding.gesture;
    [controls.modifier, controls.modifier2, controls.gesture].forEach((select) =>
      select.addEventListener("change", syncClickControls),
    );
    remove.addEventListener("click", () => {
      const index = extraControls.indexOf(controls);
      if (index >= 0) extraControls.splice(index, 1);
      row.remove();
      syncClickControls();
    });
    row.append(first.label, second.label, gesture.label, remove);
    additional.append(row);
    extraControls.push(controls);
  };
  const clearAdditional = (): void => {
    extraControls.splice(0);
    additional?.replaceChildren();
  };
  const showClickCombo = () => {
    if (!combo || !primaryControls) return;
    const legacyButton =
      storedButton && isClickType(storedButton.value) ? storedButton.value : "LEFT_CLICK";
    const bindings = resolveClickToSaveBindings(bindingsField?.value, combo.value, legacyButton);
    clearAdditional();
    const first = bindings[0];
    if (!first) return;
    writeCombo(primaryControls, first.combo);
    primaryControls.gesture.value = first.gesture;
    bindings.slice(1).forEach(addBindingRow);
    baselineSerialized = serializeClickToSaveBindings(bindings);
    syncClickControls();
  };
  [button, modifier, modifier2].forEach((control) =>
    control?.addEventListener("change", syncClickControls),
  );
  clickToSave?.addEventListener("change", syncClickControls);
  const applyGesture = () => {
    if (!bindingsField || !combo || !storedButton) return;
    const bindings = selectedBindings();
    const serialized = serializeClickToSaveBindings(bindings);
    bindingsField.value = serialized;
    bindingsField.dispatchEvent(new Event("change", { bubbles: true }));
    const legacy = bindings.find(({ gesture }) => gestureToClickType(gesture) !== null);
    if (legacy) {
      const legacyButton = gestureToClickType(legacy.gesture);
      if (legacyButton) {
        combo.value = String(legacy.combo);
        storedButton.value = legacyButton;
        combo.dispatchEvent(new Event("change", { bubbles: true }));
        storedButton.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    baselineSerialized = serialized;
    syncClickControls();
    if (status) status.textContent = getMessage("o_lShortcutUpdated") || "Shortcut updated.";
  };
  apply?.addEventListener("click", applyGesture);
  add?.addEventListener("click", () => {
    const gesture = unusedGestures()[0];
    if (!gesture) return;
    addBindingRow({ gesture, combo: "Alt" });
    syncClickControls();
  });
  reset?.addEventListener("click", () => {
    if (!primaryControls) return;
    clearAdditional();
    writeCombo(primaryControls, "Alt");
    primaryControls.gesture.value = CLICK_GESTURES.LEFT;
    applyGesture();
    if (status) status.textContent = getMessage("o_lShortcutReset") || "Shortcut reset.";
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
