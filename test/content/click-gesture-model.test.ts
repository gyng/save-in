import { describe, expect, test } from "vitest";
import { CLICK_GESTURES } from "../../src/shared/click-gesture.ts";
import {
  createDoubleClickTracker,
  isSingleGestureButton,
} from "../../src/content/click-gesture-model.ts";

describe("click gesture model", () => {
  test.each([
    [CLICK_GESTURES.LEFT, 0],
    [CLICK_GESTURES.MIDDLE, 1],
    [CLICK_GESTURES.RIGHT, 2],
    [CLICK_GESTURES.BACK, 3],
    [CLICK_GESTURES.FORWARD, 4],
  ] as const)("matches %s to mouse button %s", (gesture, button) => {
    expect(isSingleGestureButton(gesture, button)).toBe(true);
    expect(isSingleGestureButton(gesture, (button + 1) % 5)).toBe(false);
  });

  test("requires two primary presses on the same candidate", () => {
    const tracker = createDoubleClickTracker<string>((first, second) => first === second);

    expect(tracker.press(1, 0, "first")).toBe(false);
    expect(tracker.press(2, 0, "second")).toBe(false);
    expect(tracker.press(1, 0, "first")).toBe(false);
    expect(tracker.press(2, 0, "first")).toBe(true);
  });

  test("resets on another button, count, or explicit cancellation", () => {
    const tracker = createDoubleClickTracker<string>((first, second) => first === second);

    tracker.press(1, 0, "source");
    expect(tracker.press(2, 2, "source")).toBe(false);
    tracker.press(1, 0, "source");
    tracker.reset();
    expect(tracker.press(2, 0, "source")).toBe(false);
    tracker.press(1, 0, "source");
    expect(tracker.press(3, 0, "source")).toBe(false);
  });
});
