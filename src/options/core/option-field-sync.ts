// Set a single UI element's value/checked state from a schema entry + stored
// value. These transforms would belong on the option schema as onOptionsLoad,
// but the schema reaches this page via the GET_SCHEMA message and structured
// clone drops functions — so field-display transforms live here instead.
import { normalizeKeyComboForDisplay } from "./options-logic.ts";
import type { OptionSchema } from "./options-persistence.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../../platform/chrome-detector.ts";
import { LEGACY_REFERER_HEADER_FILTER } from "../../config/option-defaults.ts";
import {
  CONFLICT_ACTION,
  FORBIDDEN_FILENAME_CHARS,
  isShortcutType,
  REJECTED_SHORTCUT_TYPES,
  SHORTCUT_TYPES,
  UNSAFE_INVISIBLE_FILENAME_CHARS,
} from "../../shared/constants.ts";

type OptionDefinition = OptionSchema["keys"][number];

// Keyed by option name; an entry mirrors that option's schema onLoad, and must
// agree with option-schema.ts exactly. The page reads raw storage.local, so an
// option the background coerces on load is otherwise displayed as its stored
// value while every code path already uses another. An option whose onSave
// normalizes the same way needs no entry: storage already holds the coerced
// value. Browser detection is synchronous at chrome-detector import, so the
// capability-gated pair below is settled before any restore reaches this.
const OPTION_FIELD_DISPLAY_TRANSFORMS: Record<
  string,
  (value: unknown, option: OptionDefinition) => unknown
> = {
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
  // Empty is deletion, not an invalid replacement. The literal "_" mirrors the
  // schema rather than option.default so the two cannot drift apart.
  replacementChar: (value: unknown) =>
    typeof value === "string" &&
    value !== "" &&
    (FORBIDDEN_FILENAME_CHARS.test(value) ||
      UNSAFE_INVISIBLE_FILENAME_CHARS.test(value) ||
      value === "." ||
      value === "..")
      ? "_"
      : value,
  // The upgrade extends only the untouched pre-v4 preset (#218), and matches it
  // by exact equality — so showing the stored legacy string invites an edit that
  // no longer matches and silently drops the host the upgrade added.
  setRefererHeaderFilter: (value: unknown, option: OptionDefinition) =>
    value === LEGACY_REFERER_HEADER_FILTER ? option.default : value,
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
        ? transform(storedValue, option)
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
