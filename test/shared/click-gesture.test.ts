import { describe, expect, test } from "vitest";
import { CLICK_TYPES } from "../../src/shared/constants.ts";
import {
  CLICK_GESTURES,
  contentClickComboToKeyCodes,
  gestureToClickType,
  parseClickToSaveBindings,
  resolveClickToSaveBindings,
  serializeClickToSaveBindings,
} from "../../src/shared/click-gesture.ts";

describe("click-to-save gesture bindings", () => {
  test.each([
    [CLICK_GESTURES.LEFT, CLICK_TYPES.LEFT_CLICK],
    [CLICK_GESTURES.MIDDLE, CLICK_TYPES.MIDDLE_CLICK],
    [CLICK_GESTURES.RIGHT, CLICK_TYPES.RIGHT_CLICK],
    [CLICK_GESTURES.BACK, CLICK_TYPES.BACK_CLICK],
    [CLICK_GESTURES.FORWARD, CLICK_TYPES.FORWARD_CLICK],
    [CLICK_GESTURES.DOUBLE_LEFT, null],
  ] as const)("maps %s to its legacy compatibility value", (gesture, legacy) => {
    expect(gestureToClickType(gesture)).toBe(legacy);
  });

  test("round-trips the initial gesture set", () => {
    const bindings = [
      { gesture: CLICK_GESTURES.MIDDLE, combo: "Alt" },
      { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "" },
    ];

    expect(parseClickToSaveBindings(serializeClickToSaveBindings(bindings))).toEqual(bindings);
  });

  test("rejects duplicate and ambiguous primary-button gestures", () => {
    expect(() =>
      serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.LEFT, combo: "Ctrl" },
      ]),
    ).toThrow("Invalid click-to-save bindings");
    expect(() =>
      serializeClickToSaveBindings([
        { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
        { gesture: CLICK_GESTURES.DOUBLE_LEFT, combo: "Ctrl" },
      ]),
    ).toThrow("Invalid click-to-save bindings");
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

  test("falls back to the legacy pair without rewriting arbitrary key codes", () => {
    expect(resolveClickToSaveBindings("", 90, CLICK_TYPES.BACK_CLICK)).toEqual([
      { gesture: CLICK_GESTURES.BACK, combo: 90 },
    ]);
    expect(contentClickComboToKeyCodes(90)).toEqual([90]);
  });

  test("uses the safe default combo when a direct legacy caller is malformed", () => {
    expect(resolveClickToSaveBindings("", "bad", CLICK_TYPES.LEFT_CLICK)).toEqual([
      { gesture: CLICK_GESTURES.LEFT, combo: "Alt" },
    ]);
  });
});
