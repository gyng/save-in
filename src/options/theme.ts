import { isUiTheme, type UiTheme } from "../config/content-options.ts";

export const applyUiTheme = (
  value: unknown,
  root: HTMLElement = document.documentElement,
): UiTheme => {
  const theme = isUiTheme(value) ? value : "system";
  root.dataset.theme = theme;
  return theme;
};

export const setupUiThemeControl = (
  select: HTMLSelectElement,
  root: HTMLElement = document.documentElement,
): (() => void) => {
  const update = () => applyUiTheme(select.value, root);
  select.addEventListener("change", update);
  return () => select.removeEventListener("change", update);
};
