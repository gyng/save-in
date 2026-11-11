import { getMessage } from "../../platform/localization.ts";
import { isClickType } from "../../config/content-options.ts";
import {
  CLICK_GESTURES,
  isClickGesture,
  resolveClickToSaveBindings,
  type ClickToSaveBinding,
  type ClickToSaveBindings,
} from "../../shared/click-gesture.ts";
import { CLICK_TYPES } from "../../shared/constants.ts";

// One gesture row: two modifier selects and a click gesture select. The
// click-to-save rows and the folder picker's row are the same control group,
// so they share how a stored combo is shown and read back.
export type GestureRowControls = {
  modifier: HTMLSelectElement;
  modifier2: HTMLSelectElement;
  gesture: HTMLSelectElement;
};

const KNOWN_MODIFIERS = new Set(["Alt", "Ctrl", "Shift", "Meta"]);

export const writeGestureCombo = (controls: GestureRowControls, value: string | number): void => {
  const text = String(value);
  const parts = text.split("+").filter(Boolean);
  const unknown = parts.find((part) => !KNOWN_MODIFIERS.has(part));
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

export const readGestureBinding = (controls: GestureRowControls): ClickToSaveBinding => {
  if (controls.modifier2.value === controls.modifier.value) controls.modifier2.value = "";
  return {
    gesture: isClickGesture(controls.gesture.value) ? controls.gesture.value : CLICK_GESTURES.LEFT,
    combo: [controls.modifier.value, controls.modifier2.value].filter(Boolean).join("+"),
  };
};

// The click-to-save gestures as last applied: the versioned list, or the
// legacy pair a profile from before it still holds.
export const storedClickToSaveBindings = (): ClickToSaveBindings => {
  const button = document.querySelector<HTMLInputElement>("#contentClickToSaveButton")?.value;
  return resolveClickToSaveBindings(
    document.querySelector<HTMLInputElement>("#contentClickToSaveBindings")?.value,
    document.querySelector<HTMLInputElement>("#contentClickToSaveCombo")?.value,
    isClickType(button) ? button : CLICK_TYPES.LEFT_CLICK,
  );
};
