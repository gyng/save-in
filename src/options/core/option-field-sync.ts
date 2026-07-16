// Set a single UI element's value/checked state from a schema entry + stored
// value. These transforms would belong on the option schema as onOptionsLoad,
// but the schema reaches this page via the GET_SCHEMA message and structured
// clone drops functions — so field-display transforms live here instead.
import { normalizeKeyComboForDisplay } from "./options-logic.ts";
import type { OptionSchema } from "./options-persistence.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../../platform/chrome-detector.ts";
import {
  CONFLICT_ACTION,
  isShortcutType,
  REJECTED_SHORTCUT_TYPES,
  SHORTCUT_TYPES,
} from "../../shared/constants.ts";

// Keyed by option name; an entry mirrors that option's schema onLoad. The
// capability-gated pair below must agree with option-schema.ts exactly: the
// page reads raw storage.local, so a stored value the current browser cannot
// honour would otherwise be shown as selected while the background already
// coerced it to something else. applyBrowserCapabilityUi hides and disables
// those <option>s, but neither deselects one, so the coercion has to happen
// here. Browser detection is synchronous at chrome-detector import, so
// capabilities are settled before any restore reaches this.
const OPTION_FIELD_DISPLAY_TRANSFORMS: Record<string, (value: unknown) => unknown> = {
  contentClickToSaveCombo: (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? normalizeKeyComboForDisplay(value)
      : value,
  // Firefox never implemented the prompt conflict action (#89, #217).
  conflictAction: (value: unknown) =>
    value === CONFLICT_ACTION.PROMPT && !WEB_EXTENSION_CAPABILITIES.conflictActionPrompt
      ? CONFLICT_ACTION.UNIQUIFY
      : value,
  // Firefox fails a download whose name ends in .url/.desktop outright (#207).
  shortcutType: (value: unknown) =>
    !WEB_EXTENSION_CAPABILITIES.shortcutFileExtensions &&
    isShortcutType(value) &&
    REJECTED_SHORTCUT_TYPES.has(value)
      ? SHORTCUT_TYPES.HTML_REDIRECT
      : value,
};

export const setOptionFieldValue = (
  option: OptionSchema["keys"][number],
  storedValue: unknown,
  schema: OptionSchema,
): boolean => {
  const el = document.getElementById(option.name);
  if (!el) return false;

  // Own keys only: the registry is an object literal, so an Object.prototype
  // name like "constructor" must not resolve to an inherited member.
  const transform = Object.hasOwn(OPTION_FIELD_DISPLAY_TRANSFORMS, option.name)
    ? OPTION_FIELD_DISPLAY_TRANSFORMS[option.name]
    : undefined;
  const value =
    typeof storedValue === "undefined"
      ? option.default
      : transform
        ? transform(storedValue)
        : storedValue;
  if (option.type === schema.types.BOOL && el instanceof HTMLInputElement) {
    el.checked = Boolean(value);
    return true;
  }
  if (
    option.type === schema.types.VALUE &&
    (el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement)
  ) {
    el.value = String(value);
    return true;
  }
  return false;
};
