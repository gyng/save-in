// The folder picker's own click gesture: one gesture row that writes
// contentPickerBindings as soon as it changes. It is a separate setting from
// click-to-save, so the two can share a gesture by accident; click-to-save
// keeps a shared gesture at runtime (effectiveClickBindings), and this says so
// instead of refusing the choice.
import {
  CLICK_GESTURES,
  clickBindingsConflict,
  resolvePickerBindings,
  trySerializeClickToSaveBindings,
  type ClickToSaveBinding,
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
  const group = document.querySelector<HTMLElement>("#pickerGestureControls");
  // Each notice and when it applies to the chosen gesture. The plain left,
  // double, and long clicks take over ordinary clicks on links and media the
  // same way they do for click-to-save, so they carry the same warnings.
  const notices: Array<[HTMLElement | null, (binding: ClickToSaveBinding) => boolean]> = [
    [
      document.querySelector<HTMLElement>("#pickerGestureStatus"),
      (binding) =>
        clickToSave?.checked === true &&
        storedClickToSaveBindings().some((save) => clickBindingsConflict(binding, save)),
    ],
    [
      document.querySelector<HTMLElement>("#picker-gesture-warning"),
      (binding) => binding.gesture === CLICK_GESTURES.LEFT && binding.combo === "",
    ],
    [
      document.querySelector<HTMLElement>("#picker-gesture-double-warning"),
      (binding) => binding.gesture === CLICK_GESTURES.DOUBLE_LEFT,
    ],
    [
      document.querySelector<HTMLElement>("#picker-gesture-long-warning"),
      (binding) => binding.gesture === CLICK_GESTURES.LONG_LEFT,
    ],
  ];

  const sync = (): void => {
    const on = enabled?.checked === true;
    // A class, not :has(select:disabled): see the same note in
    // shortcut-options.ts about native select popups.
    group?.classList.toggle("is-controls-disabled", !on);
    const binding = readGestureBinding(controls);
    const shown: string[] = [];
    notices.forEach(([notice, applies]) => {
      if (!notice) return;
      notice.hidden = !(on && applies(binding));
      if (!notice.hidden) shown.push(notice.id);
    });
    // A hidden description is still reported as one, so the selects point
    // only at the notices on screen: otherwise every select would announce a
    // conflict that does not exist.
    [modifier, modifier2, gesture].forEach((select) => {
      if (shown.length > 0) select.setAttribute("aria-describedby", shown.join(" "));
      else select.removeAttribute("aria-describedby");
    });
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
