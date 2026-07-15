import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

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
const normalizeCommandToken = (value: string): string => value.toLowerCase();

const isShortcutKey = (key: string): boolean =>
  /^[a-z0-9]$/i.test(key) ||
  /^f(?:[1-9]|1[0-2])$/i.test(key) ||
  NAMED_KEYS.has(normalizeCommandToken(key));

type ShortcutLocalizer = (key: string, fallback: string) => string;
const englishShortcutMessage: ShortcutLocalizer = (_key, fallback) => fallback;

type CommandMethod = (...args: unknown[]) => unknown;
const isCommandMethod = (value: unknown): value is CommandMethod => typeof value === "function";
const invokeCommandMethod = (method: CommandMethod, args: unknown[]): Promise<unknown> =>
  Promise.resolve().then(() => {
    return Reflect.apply(method, webExtensionApi.commands, args);
  });

export const validateSourceShortcut = (
  shortcut: string,
  localize: ShortcutLocalizer = englishShortcutMessage,
): string => {
  const value = shortcut.trim();
  if (!value)
    return localize("o_lShortcutEnterOrReset", "Enter a shortcut or restore the default.");
  const parts = value.split("+").map((part) => part.trim());
  if (parts.some((part) => !part))
    return localize("o_lShortcutFormat", "Use a format like Ctrl+Shift+G.");
  const normalizedParts = parts.map((part) => [part, normalizeCommandToken(part)] as const);
  const modifiers = normalizedParts.filter(([, part]) => MODIFIERS.has(part));
  const keys = normalizedParts.filter(([, part]) => !MODIFIERS.has(part));
  if (!modifiers.some(([, part]) => PRIMARY_MODIFIERS.has(part))) {
    return localize(
      "o_lShortcutPrimaryModifier",
      "Include Ctrl, Alt, Command, or MacCtrl as a modifier.",
    );
  }
  const [keyEntry] = keys;
  if (!keyEntry) return localize("o_lShortcutAddKey", "Add a key after the modifier.");
  if (keys.length > 1) return localize("o_lShortcutOneKey", "Use one key with your modifiers.");
  const [key] = keyEntry;
  if (!isShortcutKey(key)) {
    return localize("o_lShortcutValidKey", "Choose a valid key, such as Y, 5, F12, or PageDown.");
  }
  if (new Set(normalizedParts.map(([, part]) => part)).size !== parts.length) {
    return localize("o_lShortcutNoRepeats", "Do not repeat keys or modifiers.");
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
    const key = parts.find((part) => !MODIFIERS.has(normalizeCommandToken(part))) || "";
    const modifiers = parts.filter((part) => MODIFIERS.has(normalizeCommandToken(part)));
    modifier.value =
      modifiers.find((part) => PRIMARY_MODIFIERS.has(normalizeCommandToken(part))) || "Ctrl";
    modifier2.value = modifiers.find((part) => part !== modifier.value) || "";
    input.value = key;
    syncPlatformModifiers();
  };
  const validate = () => {
    const shortcut = shortcutValue();
    const error = validateSourceShortcut(shortcut, (key, fallback) => getMessage(key) || fallback);
    const changed = shortcut !== savedShortcut;
    if (error && changed) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    apply.disabled = Boolean(error) || !changed;
    if (error && changed) announce(error, true);
    else if (changed) announce(getMessage("o_lShortcutReady") || "Ready to apply.");
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
    const updateValue: unknown = Reflect.get(webExtensionApi.commands, "update");
    if (!isCommandMethod(updateValue)) {
      announce(
        getMessage("o_lShortcutChangeUnsupported") ||
          "This browser does not support changing shortcuts here.",
        true,
      );
      apply.disabled = false;
      return;
    }
    void invokeCommandMethod(updateValue, [{ name: COMMAND, shortcut }])
      .then(() => load())
      .then((retained) => {
        if (normalizeCommandToken(retained) !== normalizeCommandToken(shortcut)) {
          throw new Error(
            getMessage("o_lShortcutRejected") ||
              "The browser did not accept this shortcut. It may be reserved or in use.",
          );
        }
        announce(getMessage("o_lShortcutUpdated") || "Shortcut updated.");
      })
      .catch((error) => announce(String(error), true));
  });
  reset.addEventListener("click", () => {
    const resetValue: unknown = Reflect.get(webExtensionApi.commands, "reset");
    if (!isCommandMethod(resetValue)) {
      announce(
        getMessage("o_lShortcutResetUnsupported") ||
          "This browser does not support restoring shortcut defaults here.",
        true,
      );
      return;
    }
    void invokeCommandMethod(resetValue, [COMMAND])
      .then(() => load())
      .then(() => announce(getMessage("o_lShortcutReset") || "Shortcut restored to its default."))
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
