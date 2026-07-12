import { webExtensionApi } from "../platform/web-extension-api.ts";

const COMMAND = "toggle-source-panel";
const MODIFIERS = new Set(["ctrl", "alt", "command", "macctrl", "shift"]);
const PRIMARY_MODIFIERS = new Set(["ctrl", "alt", "command", "macctrl"]);

export const validateSourceShortcut = (shortcut: string): string => {
  const value = shortcut.trim();
  if (!value) return "Enter a shortcut or use Reset.";
  const parts = value.split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) return "Use a format like Ctrl+Shift+Y.";
  const modifiers = parts.filter((part) => MODIFIERS.has(part.toLocaleLowerCase()));
  const keys = parts.filter((part) => !MODIFIERS.has(part.toLocaleLowerCase()));
  if (!modifiers.some((part) => PRIMARY_MODIFIERS.has(part.toLocaleLowerCase()))) {
    return "Include Ctrl, Alt, Command, or MacCtrl as a modifier.";
  }
  if (keys.length === 0) return "Add a key after the modifier.";
  if (keys.length > 1) return "Use one key with your modifiers.";
  if (new Set(parts.map((part) => part.toLocaleLowerCase())).size !== parts.length) {
    return "Do not repeat keys or modifiers.";
  }
  return "";
};

export const setupSourceShortcut = () => {
  const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcut");
  const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply");
  const reset = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset");
  const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus");
  if (!input || !apply || !reset || !status || !webExtensionApi.commands) return;

  const announce = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  let savedShortcut = "";
  const validate = () => {
    const error = validateSourceShortcut(input.value);
    const changed = input.value.trim() !== savedShortcut;
    if (error && changed) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    apply.disabled = Boolean(error) || !changed;
    if (error && changed) announce(error, true);
    else if (changed) announce("Ready to apply.");
    else announce("");
    return !error;
  };
  const load = () =>
    webExtensionApi.commands.getAll().then((commands) => {
      savedShortcut = commands.find(({ name }) => name === COMMAND)?.shortcut || "";
      input.value = savedShortcut;
      validate();
    });

  apply.addEventListener("click", () => {
    const shortcut = input.value.trim();
    if (!validate()) return;
    apply.disabled = true;
    void webExtensionApi.commands
      .update({ name: COMMAND, shortcut })
      .then(() => load())
      .then(() => announce("Shortcut updated."))
      .catch((error) => announce(String(error), true));
  });
  reset.addEventListener("click", () => {
    void webExtensionApi.commands
      .reset(COMMAND)
      .then(() => load())
      .then(() => announce("Shortcut reset."))
      .catch((error) => announce(String(error), true));
  });
  input.addEventListener("input", validate);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !apply.disabled) {
      event.preventDefault();
      apply.click();
    } else if (event.key === "Escape") {
      input.value = savedShortcut;
      validate();
    }
  });
  void load().catch((error) => announce(String(error), true));
};

document.addEventListener("DOMContentLoaded", setupSourceShortcut);
