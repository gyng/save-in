// Configuration, content, and routing all need the same persisted gesture
// vocabulary. Keeping the parser here prevents the background and the direct
// content-storage path from accepting different profile shapes.
import { CLICK_TYPES, type ClickType } from "./constants.ts";
import { isStringKeyedRecord, isStringMember } from "./util.ts";

export const CLICK_GESTURES = {
  LEFT: "left-click",
  MIDDLE: "middle-click",
  RIGHT: "right-click",
  BACK: "back-click",
  FORWARD: "forward-click",
  DOUBLE_LEFT: "double-left-click",
  LONG_LEFT: "long-left-click",
} as const;

export type ClickGesture = (typeof CLICK_GESTURES)[keyof typeof CLICK_GESTURES];

export type ClickToSaveBinding = {
  gesture: ClickGesture;
  combo: string | number;
};

export type ClickToSaveBindings = [ClickToSaveBinding, ...ClickToSaveBinding[]];

const CLICK_TO_SAVE_BINDINGS_VERSION = 1;
// One binding per gesture used to be the only shape (#15 relaxed it to one
// per gesture and key set). The bound is a sanity limit, not a UX target.
const MAX_CLICK_TO_SAVE_BINDINGS = 16;
const DEFAULT_CONTENT_CLICK_COMBO = "Alt";
const DEFAULT_CONTENT_CLICK_COMBO_KEY_CODE = 18;

const CONTENT_CLICK_COMBO_KEY_CODES: Record<string, number> = {
  alt: 18,
  option: 18,
  ctrl: 17,
  control: 17,
  shift: 16,
  meta: 91,
  cmd: 91,
  command: 91,
  win: 91,
  windows: 91,
  super: 91,
};

const CLICK_TYPE_GESTURES: Record<ClickType, ClickGesture> = {
  [CLICK_TYPES.LEFT_CLICK]: CLICK_GESTURES.LEFT,
  [CLICK_TYPES.MIDDLE_CLICK]: CLICK_GESTURES.MIDDLE,
  [CLICK_TYPES.RIGHT_CLICK]: CLICK_GESTURES.RIGHT,
  [CLICK_TYPES.BACK_CLICK]: CLICK_GESTURES.BACK,
  [CLICK_TYPES.FORWARD_CLICK]: CLICK_GESTURES.FORWARD,
};

export const isClickGesture = (value: unknown): value is ClickGesture =>
  isStringMember(Object.values(CLICK_GESTURES), value);

const clickTypeToGesture = (value: ClickType): ClickGesture => CLICK_TYPE_GESTURES[value];

export const gestureToClickType = (gesture: ClickGesture): ClickType | null => {
  switch (gesture) {
    case CLICK_GESTURES.LEFT:
      return CLICK_TYPES.LEFT_CLICK;
    case CLICK_GESTURES.MIDDLE:
      return CLICK_TYPES.MIDDLE_CLICK;
    case CLICK_GESTURES.RIGHT:
      return CLICK_TYPES.RIGHT_CLICK;
    case CLICK_GESTURES.BACK:
      return CLICK_TYPES.BACK_CLICK;
    case CLICK_GESTURES.FORWARD:
      return CLICK_TYPES.FORWARD_CLICK;
    case CLICK_GESTURES.DOUBLE_LEFT:
    case CLICK_GESTURES.LONG_LEFT:
      return null;
  }
};

const isPositiveKeyCode = (value: string | number): boolean => {
  const keyCode = Number(value);
  return Number.isSafeInteger(keyCode) && keyCode > 0;
};

const contentClickComboParts = (value: string | number): string[] | null => {
  if (typeof value === "number") return isPositiveKeyCode(value) ? [String(value)] : null;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "none") return [];
  const parts = normalized.split("+").map((part) => part.trim().toLowerCase());
  return parts.every(
    (part) =>
      Boolean(part) &&
      (Object.hasOwn(CONTENT_CLICK_COMBO_KEY_CODES, part) || isPositiveKeyCode(part)),
  )
    ? parts
    : null;
};

export const isContentClickCombo = (value: unknown): value is string | number =>
  (typeof value === "string" || typeof value === "number") &&
  contentClickComboParts(value) !== null;

export const contentClickComboToKeyCodes = (
  value: string | number | null | undefined,
): number[] => {
  if (value == null) return [];
  const parts = contentClickComboParts(value);
  // Invalid imported/profile values must not silently weaken the shortcut to
  // button-only. The option normalizer uses the same parser, but this keeps
  // direct callers safe too.
  if (parts === null) return [DEFAULT_CONTENT_CLICK_COMBO_KEY_CODE];
  return parts
    .map((part) => {
      const namedKeyCode = CONTENT_CLICK_COMBO_KEY_CODES[part];
      return Object.hasOwn(CONTENT_CLICK_COMBO_KEY_CODES, part) && typeof namedKeyCode === "number"
        ? namedKeyCode
        : Number(part);
    })
    .filter((keyCode) => keyCode > 0);
};

// The keys: routing matcher reads this spelling, so it is a persisted rule
// contract: lowercase names in a fixed order (ctrl, alt, shift, meta), then any
// other key code as a decimal number in ascending order, joined with "+". A
// binding that needs no key is "none" rather than "", so `^none$` reads as
// what it means and a rule can never confuse it with a save that has no
// click-to-save keys at all (menu, Quick save, automatic, external).
const CLICK_KEY_NAMES: ReadonlyArray<readonly [number, string]> = [
  [17, "ctrl"],
  [18, "alt"],
  [16, "shift"],
  [91, "meta"],
];
const NO_CLICK_KEYS = "none";

export const clickKeysForCombo = (combo: string | number): string => {
  const codes = new Set(contentClickComboToKeyCodes(combo));
  const named = CLICK_KEY_NAMES.filter(([code]) => codes.has(code));
  const namedCodes = new Set(named.map(([code]) => code));
  const others = [...codes].filter((code) => !namedCodes.has(code)).toSorted((a, b) => a - b);
  const parts = [...named.map(([, name]) => name), ...others.map(String)];
  return parts.length > 0 ? parts.join("+") : NO_CLICK_KEYS;
};

// Message, history and debugger values are untrusted: anything the combo
// parser accepts is re-spelled canonically, and anything else is absent rather
// than guessed. A blank value is absent too, not "none": a blank debugger field
// or history variable means the save carried no keys, not a keyless binding.
export const normalizeClickKeys = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" && isContentClickCombo(value)
    ? clickKeysForCombo(value)
    : undefined;

export const isClickKeys = (value: unknown): value is string =>
  typeof value === "string" && normalizeClickKeys(value) === value;

// A single left click resolves on mousedown, before a double or long left
// click can be recognized, so those conflict whatever their keys. Every other
// pair conflicts only on the same gesture with the same keys (#15).
const gestureFamilyConflicts = (gesture: ClickGesture, other: ClickGesture): boolean =>
  (gesture === CLICK_GESTURES.LEFT &&
    (other === CLICK_GESTURES.DOUBLE_LEFT || other === CLICK_GESTURES.LONG_LEFT)) ||
  (other === CLICK_GESTURES.LEFT &&
    (gesture === CLICK_GESTURES.DOUBLE_LEFT || gesture === CLICK_GESTURES.LONG_LEFT));

export const clickBindingsConflict = (
  binding: ClickToSaveBinding,
  other: ClickToSaveBinding,
): boolean =>
  gestureFamilyConflicts(binding.gesture, other.gesture) ||
  (binding.gesture === other.gesture &&
    clickKeysForCombo(binding.combo) === clickKeysForCombo(other.combo));

const hasBindingConflicts = (bindings: ClickToSaveBinding[]): boolean =>
  bindings.some((binding, index) =>
    bindings.slice(index + 1).some((other) => clickBindingsConflict(binding, other)),
  );

export const parseClickToSaveBindings = (value: unknown): ClickToSaveBindings | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isStringKeyedRecord(parsed) ||
      parsed.version !== CLICK_TO_SAVE_BINDINGS_VERSION ||
      !Array.isArray(parsed.bindings) ||
      parsed.bindings.length === 0 ||
      parsed.bindings.length > MAX_CLICK_TO_SAVE_BINDINGS
    ) {
      return null;
    }
    const bindings: ClickToSaveBinding[] = [];
    for (const candidate of parsed.bindings) {
      if (
        !isStringKeyedRecord(candidate) ||
        !isClickGesture(candidate.gesture) ||
        !isContentClickCombo(candidate.combo)
      ) {
        return null;
      }
      // Only the gesture and its keys are read, so a property this version
      // does not know (a development profile's per-binding action, or a newer
      // version's addition) leaves an ordinary binding instead of
      // invalidating the list.
      bindings.push({ gesture: candidate.gesture, combo: candidate.combo });
    }
    // The length guard above proves this branded non-empty collection.
    return hasBindingConflicts(bindings) ? null : (bindings as ClickToSaveBindings);
  } catch {
    return null;
  }
};

export const isStoredClickToSaveBindings = (value: unknown): value is string =>
  value === "" || parseClickToSaveBindings(value) !== null;

export const trySerializeClickToSaveBindings = (bindings: ClickToSaveBinding[]): string | null =>
  bindings.length === 0 ||
  bindings.length > MAX_CLICK_TO_SAVE_BINDINGS ||
  bindings.some(({ gesture, combo }) => !isClickGesture(gesture) || !isContentClickCombo(combo)) ||
  hasBindingConflicts(bindings)
    ? null
    : JSON.stringify({
        version: CLICK_TO_SAVE_BINDINGS_VERSION,
        bindings: bindings.map(({ gesture, combo }) => ({ gesture, combo })),
      });

export const serializeClickToSaveBindings = (bindings: ClickToSaveBinding[]): string => {
  const serialized = trySerializeClickToSaveBindings(bindings);
  if (serialized === null) {
    throw new Error("Invalid click-to-save bindings");
  }
  return serialized;
};

// Pre-4.1 content scripts read only the legacy combo/button pair and have no
// per-pair off state: an empty combo means "no modifier required", and an
// invalid combo or button normalizes back to Alt / LEFT_CLICK. The one shape
// an old script treats as inert is a syntactically valid modifier key code
// that no keyboard event produces, so the options page mirrors a
// non-legacy-representable configuration (e.g. double-left only) as this
// unpressable combo instead of leaving the previous gesture behind.
export const LEGACY_CLICK_TO_SAVE_DISABLED_COMBO = "999";

export const resolveClickToSaveBindings = (
  serialized: unknown,
  legacyCombo: unknown,
  legacyButton: ClickType,
): ClickToSaveBindings =>
  parseClickToSaveBindings(serialized) ?? [
    {
      gesture: clickTypeToGesture(legacyButton),
      combo: isContentClickCombo(legacyCombo) ? legacyCombo : DEFAULT_CONTENT_CLICK_COMBO,
    },
  ];

// The folder picker's gesture is its own setting, stored in the click-to-save
// bindings format so one parser guards both. It has no legacy pair to fall
// back to: anything unreadable, or empty, is the default gesture.
const DEFAULT_PICKER_BINDING: ClickToSaveBinding = {
  gesture: CLICK_GESTURES.LEFT,
  combo: "Alt+Shift",
};

export const DEFAULT_PICKER_BINDINGS = serializeClickToSaveBindings([DEFAULT_PICKER_BINDING]);

export const isStoredPickerBindings = (value: unknown): value is string =>
  parseClickToSaveBindings(value) !== null;

export const resolvePickerBindings = (serialized: unknown): ClickToSaveBindings =>
  parseClickToSaveBindings(serialized) ?? [DEFAULT_PICKER_BINDING];

export const CLICK_ACTIONS = {
  SAVE: "save",
  PICKER: "picker",
} as const;

export type EffectiveClickBinding = ClickToSaveBinding & {
  action: (typeof CLICK_ACTIONS)[keyof typeof CLICK_ACTIONS];
};

// What the content gesture engine listens for. Each feature contributes its
// bindings only while it is on (null when off). The engine resolves one
// binding per input, so a picker binding that conflicts with a live
// click-to-save binding cannot coexist with it: click-to-save keeps the
// gesture and the picker binding is dropped.
export const effectiveClickBindings = (
  saveBindings: readonly ClickToSaveBinding[] | null,
  pickerBindings: readonly ClickToSaveBinding[] | null,
): EffectiveClickBinding[] => {
  const saves = saveBindings ?? [];
  return [
    ...saves.map(({ gesture, combo }) => ({ gesture, combo, action: CLICK_ACTIONS.SAVE })),
    ...(pickerBindings ?? [])
      .filter((binding) => !saves.some((save) => clickBindingsConflict(binding, save)))
      .map(({ gesture, combo }) => ({ gesture, combo, action: CLICK_ACTIONS.PICKER })),
  ];
};
