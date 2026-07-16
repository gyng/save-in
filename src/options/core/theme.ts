import { normalizeUiTheme, type UiTheme } from "../../config/content-options.ts";

export const applyUiTheme = (
  value: unknown,
  root: HTMLElement = document.documentElement,
): UiTheme => {
  const theme = normalizeUiTheme(value);
  root.dataset.theme = theme;
  return theme;
};

export const setupUiThemeControl = (
  valueInput: HTMLInputElement,
  picker: HTMLElement,
  root: HTMLElement = document.documentElement,
): (() => void) => {
  const choices = [...picker.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const sync = () => {
    const theme = applyUiTheme(valueInput.value, root);
    valueInput.value = theme;
    choices.forEach((choice) => {
      choice.checked = choice.value === theme;
    });
  };
  const choose = (event: Event) => {
    const choice = event.target;
    if (!(choice instanceof HTMLInputElement) || choice.type !== "radio" || !choice.checked) return;
    valueInput.value = choice.value;
    valueInput.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const restored = () => sync();

  picker.addEventListener("change", choose);
  valueInput.addEventListener("change", sync);
  valueInput.ownerDocument.addEventListener("options-restored", restored);
  sync();

  return () => {
    picker.removeEventListener("change", choose);
    valueInput.removeEventListener("change", sync);
    valueInput.ownerDocument.removeEventListener("options-restored", restored);
  };
};
