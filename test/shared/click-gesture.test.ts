import { describe, expect, test } from "vitest";
import { CLICK_TYPES } from "../../src/shared/constants.ts";
import {
  CLICK_ACTIONS,
  CLICK_GESTURES,
  DEFAULT_PICKER_BINDINGS,
  clickBindingsConflict,
  clickKeysForCombo,
  effectiveClickBindings,
  isStoredPickerBindings,
  resolvePickerBindings,
  contentClickComboToKeyCodes,
  isClickKeys,
  normalizeClickKeys,
  gestureToClickType,
  LEGACY_CLICK_TO_SAVE_DISABLED_COMBO,
  parseClickToSaveBindings,
  resolveClickToSaveBindings,
  serializeClickToSaveBindings,
  trySerializeClickToSaveBindings,
} from "../../src/shared/click-gesture.ts";

describe("click-to-save gesture bindings", () => {
  test.each([
    [CLICK_GESTURES.LEFT, CLICK_TYPES.LEFT_CLICK],
    [CLICK_GESTURES.MIDDLE, CLICK_TYPES.MIDDLE_CLICK],
    [CLICK_GESTURES.RIGHT, CLICK_TYPES.RIGHT_CLICK],
    [CLICK_GESTURES.BACK, CLICK_TYPES.BACK_CLICK],
    [CLICK_GESTURES.FORWARD, CLICK_TYPES.FORWARD_CLICK],
    [CLICK_GESTURES.DOUBLE_LEFT, null],
    [CLICK_GESTURES.LONG_LEFT, null],
  ] as const)("maps %s to its legacy compatibility value", (gesture, legacy) => {
    expect(gestureToClickType(gesture)).toBe(legacy);
  });

  test("round-trips the initial gesture set", () => {
    const bindings = [
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
      { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
      { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Ctrl" },
    ];

    expect(parseClickToSaveBindings(serializeClickToSaveBindings(bindings))).toEqual(bindings);
  });

  // A per-binding action was an unreleased shape. A development profile that
  // still stores one keeps its gestures as ordinary bindings.
  test("ignores a stored property it does not know and never writes it back", () => {
    const stored =
      '{"version":1,"bindings":[{"gesture":"middle-click","combo":"Alt","action":"picker"},' +
      '{"gesture":"long-left-click","combo":18,"action":7}]}';
    const parsed = parseClickToSaveBindings(stored);

    expect(parsed).toEqual([
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
      { gesture: CLICK_GESTURES.LONG_LEFT, combo: 18 },
    ]);
    expect(serializeClickToSaveBindings(parsed ?? [])).toBe(
      '{"version":1,"bindings":[{"gesture":"middle-click","combo":"Alt"},' +
        '{"gesture":"long-left-click","combo":18}]}',
    );
  });

  test("allows one gesture with different keys (#15)", () => {
    const bindings = [
      { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
      { gesture: CLICK_GESTURES.LEFT, combo: "Ctrl" },
      { gesture: CLICK_GESTURES.LEFT, combo: "Alt+Shift" },
      { gesture: CLICK_GESTURES.LEFT, combo: "" },
    ];

    expect(parseClickToSaveBindings(serializeClickToSaveBindings(bindings))).toEqual(bindings);
  });

  test.each([
    ["Alt", "Alt"],
    ["Alt", "alt"],
    ["Alt", 18],
    ["Ctrl+Shift", "Shift+Ctrl"],
    ["", "None"],
    ["Alt", "Alt+18"],
  ] as const)("rejects one gesture repeated with the same keys: %j and %j", (first, second) => {
    expect(
      trySerializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.MIDDLE, combo: first },
        { gesture: CLICK_GESTURES.MIDDLE, combo: second },
      ]),
    ).toBeNull();
  });

  test("bounds the number of bindings", () => {
    const bindings = Array.from({ length: 17 }, (_, index) => ({
      gesture: CLICK_GESTURES.MIDDLE,
      combo: String(index + 100),
    }));
    expect(trySerializeClickToSaveBindings(bindings.slice(0, 16))).not.toBeNull();
    expect(trySerializeClickToSaveBindings(bindings)).toBeNull();
    expect(parseClickToSaveBindings(JSON.stringify({ version: 1, bindings: bindings }))).toBeNull();
  });

  test("rejects a single left click beside a double or long left click whatever the keys", () => {
    expect(() =>
      serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Ctrl" },
      ]),
    ).toThrow("Invalid click-to-save bindings");
    expect(() =>
      serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Ctrl" },
      ]),
    ).toThrow("Invalid click-to-save bindings");
  });

  test("allows double-left and long-left to coexist", () => {
    const bindings = [
      { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Alt" },
      { gesture: CLICK_GESTURES.LONG_LEFT, combo: "Alt" },
    ];

    expect(parseClickToSaveBindings(serializeClickToSaveBindings(bindings))).toEqual(bindings);
  });

  test.each([
    "not json",
    JSON.stringify({ version: 2, bindings: [] }),
    JSON.stringify({ version: 1, bindings: [] }),
    JSON.stringify({ version: 1, bindings: [{ gesture: "long-left-press", combo: "Alt" }] }),
    JSON.stringify({ version: 1, bindings: [{ gesture: "left-click", combo: "bad" }] }),
  ])("rejects malformed stored bindings: %s", (value) => {
    expect(parseClickToSaveBindings(value)).toBeNull();
  });

  test("reports invalid bindings as null through the non-throwing serializer", () => {
    expect(
      trySerializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.LEFT, combo: "alt" },
      ]),
    ).toBeNull();
    expect(
      trySerializeClickToSaveBindings([{ gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" }]),
    ).toBe(serializeClickToSaveBindings([{ gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" }]));
  });

  test("the disabled legacy mirror is valid yet inert for legacy consumers", () => {
    // Pre-4.1 content scripts resolve the mirrored pair directly. The disabled
    // sentinel must survive their normalizers (no fallback to Alt/left-click)
    // while resolving to a modifier key code no keyboard event can produce.
    expect(
      resolveClickToSaveBindings("", LEGACY_CLICK_TO_SAVE_DISABLED_COMBO, CLICK_TYPES.LEFT_CLICK),
    ).toEqual([{ gesture: CLICK_GESTURES.LEFT, combo: LEGACY_CLICK_TO_SAVE_DISABLED_COMBO }]);
    expect(contentClickComboToKeyCodes(LEGACY_CLICK_TO_SAVE_DISABLED_COMBO)).toEqual([999]);
  });

  test("falls back to the legacy pair without rewriting arbitrary key codes", () => {
    expect(resolveClickToSaveBindings("", 90, CLICK_TYPES.BACK_CLICK)).toEqual([
      { gesture: CLICK_GESTURES.BACK, combo: 90 },
    ]);
    expect(contentClickComboToKeyCodes(90)).toEqual([90]);
  });

  test.each([
    ["Alt", [18]],
    ["Option", [18]],
    ["ctrl", [17]],
    ["Command", [91]],
    ["Ctrl+Shift", [17, 16]],
    [18, [18]],
    ["18", [18]],
    [90, [90]],
    ["None", []],
    ["", []],
    [undefined, []],
  ] as const)("converts the backward-compatible modifier value %j", (value, keyCodes) => {
    expect(contentClickComboToKeyCodes(value)).toEqual(keyCodes);
  });

  test.each(["garbage", "Ctrl+garbage"])(
    "does not weaken a malformed modifier value %j to mouse-only",
    (value) => {
      expect(contentClickComboToKeyCodes(value)).toEqual([18]);
    },
  );

  test("uses the safe default combo when a direct legacy caller is malformed", () => {
    expect(resolveClickToSaveBindings("", "bad", CLICK_TYPES.LEFT_CLICK)).toEqual([
      { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
    ]);
  });

  test.each([
    ["Alt", "alt"],
    ["Option", "alt"],
    ["Control", "ctrl"],
    ["Command", "meta"],
    ["Shift+Alt+Ctrl+Meta", "ctrl+alt+shift+meta"],
    ["Shift+Ctrl", "ctrl+shift"],
    ["Alt+18", "alt"],
    [18, "alt"],
    ["17+16", "ctrl+shift"],
    ["90+Ctrl+65", "ctrl+65+90"],
    [90, "90"],
    ["", "none"],
    ["None", "none"],
    [LEGACY_CLICK_TO_SAVE_DISABLED_COMBO, "999"],
  ] as const)("spells the keys of combo %j canonically as %j", (combo, keys) => {
    expect(clickKeysForCombo(combo)).toBe(keys);
    expect(normalizeClickKeys(keys)).toBe(keys);
    expect(isClickKeys(keys)).toBe(true);
  });

  test.each([
    ["Alt+Ctrl", "ctrl+alt"],
    ["  shift + ctrl ", "ctrl+shift"],
    ["NONE", "none"],
    ["91", "meta"],
  ])("normalizes the untrusted keys value %j to %j", (value, keys) => {
    expect(normalizeClickKeys(value)).toBe(keys);
    expect(isClickKeys(value)).toBe(false);
  });

  test.each([undefined, null, 18, "", "   ", "garbage", "alt+garbage", "0", "-1", "alt++", {}])(
    "treats the malformed keys value %j as absent",
    (value) => {
      expect(normalizeClickKeys(value)).toBeUndefined();
      expect(isClickKeys(value)).toBe(false);
    },
  );
});

describe("folder picker gesture", () => {
  const { LEFT, MIDDLE, DOUBLE_LEFT, LONG_LEFT } = CLICK_GESTURES;
  const save = (gesture: (typeof CLICK_GESTURES)[keyof typeof CLICK_GESTURES], combo: string) => ({
    gesture,
    combo,
    action: CLICK_ACTIONS.SAVE,
  });
  const picker = (
    gesture: (typeof CLICK_GESTURES)[keyof typeof CLICK_GESTURES],
    combo: string,
  ) => ({ gesture, combo, action: CLICK_ACTIONS.PICKER });

  test("defaults to Alt+Shift with a left click", () => {
    expect(DEFAULT_PICKER_BINDINGS).toBe(
      '{"version":1,"bindings":[{"gesture":"left-click","combo":"Alt+Shift"}]}',
    );
    expect(resolvePickerBindings(DEFAULT_PICKER_BINDINGS)).toEqual([
      { gesture: LEFT, combo: "Alt+Shift" },
    ]);
  });

  test("reads a stored gesture", () => {
    const stored = serializeClickToSaveBindings([{ gesture: LONG_LEFT, combo: "" }]);

    expect(isStoredPickerBindings(stored)).toBe(true);
    expect(resolvePickerBindings(stored)).toEqual([{ gesture: LONG_LEFT, combo: "" }]);
  });

  // Unlike the click-to-save list, empty has no legacy meaning here.
  test.each([
    undefined,
    null,
    "",
    "   ",
    "{",
    7,
    {},
    '{"version":2,"bindings":[{"gesture":"left-click","combo":"Alt"}]}',
    '{"version":1,"bindings":[]}',
    '{"version":1,"bindings":[{"gesture":"tap","combo":"Alt"}]}',
    '{"version":1,"bindings":[{"gesture":"left-click","combo":"garbage"}]}',
  ])("falls back to the default for the stored value %j", (stored) => {
    expect(isStoredPickerBindings(stored)).toBe(false);
    expect(resolvePickerBindings(stored)).toEqual([{ gesture: LEFT, combo: "Alt+Shift" }]);
  });

  test.each([
    [LEFT, "Alt", LEFT, "alt", true],
    [LEFT, "Alt", LEFT, "Alt+Shift", false],
    [MIDDLE, "", MIDDLE, "none", true],
    [MIDDLE, "Alt", LEFT, "Alt", false],
    [LEFT, "Alt", DOUBLE_LEFT, "Ctrl", true],
    [DOUBLE_LEFT, "Ctrl", LEFT, "Alt", true],
    [LEFT, "Alt", LONG_LEFT, "", true],
    [LONG_LEFT, "", LEFT, "Alt", true],
    [DOUBLE_LEFT, "", LONG_LEFT, "", false],
    [LONG_LEFT, "Alt", LONG_LEFT, "Shift", false],
  ] as const)("%s %j beside %s %j conflicts: %j", (gesture, combo, other, otherCombo, expected) => {
    expect(clickBindingsConflict({ gesture, combo }, { gesture: other, combo: otherCombo })).toBe(
      expected,
    );
  });

  test.each([
    ["both off", null, null, []],
    ["click-to-save alone", [{ gesture: LEFT, combo: "Alt" }], null, [save(LEFT, "Alt")]],
    [
      "the picker alone",
      null,
      [{ gesture: LEFT, combo: "Alt+Shift" }],
      [picker(LEFT, "Alt+Shift")],
    ],
    [
      "both on",
      [
        { gesture: LEFT, combo: "Alt" },
        { gesture: MIDDLE, combo: "" },
      ],
      [{ gesture: LEFT, combo: "Alt+Shift" }],
      [save(LEFT, "Alt"), save(MIDDLE, ""), picker(LEFT, "Alt+Shift")],
    ],
    [
      "the same gesture and keys",
      [{ gesture: MIDDLE, combo: "Alt" }],
      [{ gesture: MIDDLE, combo: "alt" }],
      [save(MIDDLE, "Alt")],
    ],
    [
      "a long left click for the picker beside a single left click",
      [{ gesture: LEFT, combo: "Alt" }],
      [{ gesture: LONG_LEFT, combo: "" }],
      [save(LEFT, "Alt")],
    ],
    [
      "a single left click for the picker beside a double left click",
      [{ gesture: DOUBLE_LEFT, combo: "" }],
      [{ gesture: LEFT, combo: "Alt+Shift" }],
      [save(DOUBLE_LEFT, "")],
    ],
    [
      "only the conflicting picker binding",
      [{ gesture: MIDDLE, combo: "" }],
      [
        { gesture: MIDDLE, combo: "" },
        { gesture: MIDDLE, combo: "Shift" },
      ],
      [save(MIDDLE, ""), picker(MIDDLE, "Shift")],
    ],
  ] as const)(
    "merges %s, with click-to-save keeping a shared gesture",
    (_, saves, pickers, expected) => {
      expect(effectiveClickBindings(saves, pickers)).toEqual(expected);
    },
  );

  test("carries nothing but the gesture, its keys, and the action", () => {
    const withExtras = [{ gesture: MIDDLE, combo: "", action: "picker", keyCodes: [1] }];

    expect(effectiveClickBindings(withExtras, null)).toEqual([save(MIDDLE, "")]);
    expect(effectiveClickBindings(null, withExtras)).toEqual([picker(MIDDLE, "")]);
  });
});
