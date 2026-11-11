// The folder picker's own click gesture: one gesture row that writes
// contentPickerBindings as soon as it changes. It is a separate setting from
// click-to-save, so the two can share a gesture by accident; click-to-save
// keeps a shared gesture at runtime (effectiveClickBindings), and this says so
// instead of refusing the choice.
import {
  clickBindingsConflict,
  resolvePickerBindings,
  trySerializeClickToSaveBindings,
} from "../../shared/click-gesture.ts";
import { readGestureBinding, storedClickToSaveBindings, writeGestureCombo } from "./gesture-row.ts";

export const setupPickerGesture = (): void => {
  const field = document.querySelector<HTMLInputElement>("#contentPickerBindings");
  const modifier = document.querySelector<HTMLSelectElement>("#pickerGestureModifier");
  const modifier2 = document.querySelector<HTMLSelectElement>("#pickerGestureModifier2");
  const gesture = document.querySelector<HTMLSelectElement>("#pickerGestureButton");
  if (!field || !modifier || !modifier2 || !gesture) return;
  const controls = { modifier, modifier2, gesture };
  const enabled = document.querySelector<HTMLInputElement>("#contentPickerGesture");
  const clickToSave = document.querySelector<HTMLInputElement>("#contentClickToSave");
  const status = document.querySelector<HTMLElement>("#pickerGestureStatus");
  const group = document.querySelector<HTMLElement>("#pickerGestureControls");

  const sync = (): void => {
    const on = enabled?.checked === true;
    // A class, not :has(select:disabled): see the same note in
    // shortcut-options.ts about native select popups.
    group?.classList.toggle("is-controls-disabled", !on);
    if (!status) return;
    const binding = readGestureBinding(controls);
    status.hidden = !(
      on &&
      clickToSave?.checked === true &&
      storedClickToSaveBindings().some((save) => clickBindingsConflict(binding, save))
    );
  };
  const show = (): void => {
    const [binding] = resolvePickerBindings(field.value);
    writeGestureCombo(controls, binding.combo);
    gesture.value = binding.gesture;
    sync();
  };
  const write = (): void => {
    const serialized = trySerializeClickToSaveBindings([readGestureBinding(controls)]);
    if (serialized !== null && serialized !== field.value) {
      field.value = serialized;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sync();
  };

  [modifier, modifier2, gesture].forEach((select) => select.addEventListener("change", write));
  [
    enabled,
    clickToSave,
    ...["#contentClickToSaveBindings", "#contentClickToSaveCombo", "#contentClickToSaveButton"].map(
      (selector) => document.querySelector<HTMLInputElement>(selector),
    ),
  ].forEach((control) => control?.addEventListener("change", sync));
  // Restore and import set the stored value without a change event.
  document.addEventListener("options-restored", show);
  show();
};
