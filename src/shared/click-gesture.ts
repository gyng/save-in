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
} as const;

export type ClickGesture = (typeof CLICK_GESTURES)[keyof typeof CLICK_GESTURES];

export type ClickToSaveBinding = {
  gesture: ClickGesture;
  combo: string | number;
};

export type ClickToSaveBindings = [ClickToSaveBinding, ...ClickToSaveBinding[]];

const CLICK_TO_SAVE_BINDINGS_VERSION = 1;
const MAX_CLICK_TO_SAVE_BINDINGS = Object.keys(CLICK_GESTURES).length;
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

const hasBindingConflicts = (bindings: ClickToSaveBinding[]): boolean => {
  const gestures = new Set(bindings.map(({ gesture }) => gesture));
  return (
    gestures.size !== bindings.length ||
    (gestures.has(CLICK_GESTURES.LEFT) && gestures.has(CLICK_GESTURES.DOUBLE_LEFT))
  );
};

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

export const serializeClickToSaveBindings = (bindings: ClickToSaveBinding[]): string => {
  if (
    bindings.length === 0 ||
    bindings.length > MAX_CLICK_TO_SAVE_BINDINGS ||
    bindings.some(
      ({ gesture, combo }) => !isClickGesture(gesture) || !isContentClickCombo(combo),
    ) ||
    hasBindingConflicts(bindings)
  ) {
    throw new Error("Invalid click-to-save bindings");
  }
  return JSON.stringify({ version: CLICK_TO_SAVE_BINDINGS_VERSION, bindings });
};

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
