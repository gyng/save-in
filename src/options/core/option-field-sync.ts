// Set a single UI element's value/checked state from a schema entry + stored
// value. These transforms would belong on the option schema as onOptionsLoad,
// but the schema reaches this page via the GET_SCHEMA message and structured
// clone drops functions — so field-display transforms live here instead.
import { normalizeKeyComboForDisplay } from "./options-logic.ts";
import type { OptionSchema } from "./options-persistence.ts";

const OPTION_FIELD_DISPLAY_TRANSFORMS = {
  contentClickToSaveCombo: (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? normalizeKeyComboForDisplay(value)
      : value,
};

export const setOptionFieldValue = (
  option: OptionSchema["keys"][number],
  storedValue: unknown,
  schema: OptionSchema,
): boolean => {
  const el = document.getElementById(option.name);
  if (!el) return false;

  const transform =
    option.name === "contentClickToSaveCombo"
      ? OPTION_FIELD_DISPLAY_TRANSFORMS.contentClickToSaveCombo
      : (value: unknown) => value;
  const value = typeof storedValue === "undefined" ? option.default : transform(storedValue);
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
