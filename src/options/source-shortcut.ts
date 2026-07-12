import { webExtensionApi } from "../platform/web-extension-api.ts";

const COMMAND = "toggle-source-panel";
const MODIFIERS = new Set(["ctrl", "alt", "command", "macctrl", "shift"]);
const PRIMARY_MODIFIERS = new Set(["ctrl", "alt", "command", "macctrl"]);
const NAMED_KEYS = new Set([
  "comma",
  "period",
  "home",
  "end",
  "pageup",
  "pagedown",
  "space",
  "insert",
  "delete",
  "up",
  "down",
  "left",
  "right",
]);

const isShortcutKey = (key: string): boolean =>
  /^[a-z0-9]$/i.test(key) ||
  /^f(?:[1-9]|1[0-2])$/i.test(key) ||
  NAMED_KEYS.has(key.toLocaleLowerCase());

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
  if (!isShortcutKey(keys[0])) {
    return "Choose a valid key, such as Y, 5, F12, or PageDown.";
  }
  if (new Set(parts.map((part) => part.toLocaleLowerCase())).size !== parts.length) {
    return "Do not repeat keys or modifiers.";
  }
  return "";
};

export const setupSourceShortcut = () => {
  const modifier = document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier");
  const modifier2 = document.querySelector<HTMLSelectElement>("#sourcePanelShortcutModifier2");
  const input = document.querySelector<HTMLInputElement>("#sourcePanelShortcutKey");
  const apply = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutApply");
  const reset = document.querySelector<HTMLButtonElement>("#sourcePanelShortcutReset");
  const status = document.querySelector<HTMLElement>("#sourcePanelShortcutStatus");
  if (!modifier || !modifier2 || !input || !apply || !reset || !status || !webExtensionApi.commands)
    return;

  const announce = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle("error", error);
  };
  let savedShortcut = "";
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const syncPlatformModifiers = () => {
    [modifier, modifier2].forEach((select) => {
      [...select.options].forEach((option) => {
        const macOnly = option.value === "Command" || option.value === "MacCtrl";
        const unavailable = macOnly && !isMac && option.value !== select.value;
        option.hidden = unavailable;
        option.disabled = unavailable;
      });
    });
  };
  const shortcutValue = () => {
    const key = input.value.trim();
    return key ? [modifier.value, modifier2.value, key].filter(Boolean).join("+") : "";
  };
  const showShortcut = (shortcut: string) => {
    const parts = shortcut.split("+").filter(Boolean);
    const key = parts.find((part) => !MODIFIERS.has(part.toLocaleLowerCase())) || "";
    const modifiers = parts.filter((part) => MODIFIERS.has(part.toLocaleLowerCase()));
    modifier.value =
      modifiers.find((part) => PRIMARY_MODIFIERS.has(part.toLocaleLowerCase())) || "Ctrl";
    modifier2.value = modifiers.find((part) => part !== modifier.value) || "";
    input.value = key;
    syncPlatformModifiers();
  };
  const validate = () => {
    const shortcut = shortcutValue();
    const error = validateSourceShortcut(shortcut);
    const changed = shortcut !== savedShortcut;
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
      showShortcut(savedShortcut);
      validate();
      return savedShortcut;
    });

  apply.addEventListener("click", () => {
    const shortcut = shortcutValue();
    if (!validate()) return;
    apply.disabled = true;
    void webExtensionApi.commands
      .update({ name: COMMAND, shortcut })
      .then(() => load())
      .then((retained) => {
        if (retained.toLocaleLowerCase() !== shortcut.toLocaleLowerCase()) {
          throw new Error(
            "The browser did not accept this shortcut. It may be reserved or in use.",
          );
        }
        announce("Shortcut updated.");
      })
      .catch((error) => announce(String(error), true));
  });
  reset.addEventListener("click", () => {
    void webExtensionApi.commands
      .reset(COMMAND)
      .then(() => load())
      .then(() => announce("Shortcut reset."))
      .catch((error) => announce(String(error), true));
  });
  modifier.addEventListener("change", () => {
    if (modifier2.value === modifier.value) modifier2.value = "";
    validate();
    syncPlatformModifiers();
  });
  modifier2.addEventListener("change", validate);
  input.addEventListener("input", validate);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !apply.disabled) {
      event.preventDefault();
      apply.click();
    } else if (event.key === "Escape") {
      showShortcut(savedShortcut);
      validate();
    }
  });
  void load().catch((error) => announce(String(error), true));
  syncPlatformModifiers();
};

document.addEventListener("DOMContentLoaded", setupSourceShortcut);
