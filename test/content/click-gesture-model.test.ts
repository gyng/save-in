import { describe, expect, test } from "vitest";
import { CLICK_GESTURES } from "../../src/shared/click-gesture.ts";
import {
  createDoubleClickTracker,
  createFollowUpSuppressor,
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

  test("suppresses each middle-click follow-up exactly once for the armed button", () => {
    const suppressor = createFollowUpSuppressor();

    expect(suppressor.suppress("auxclick", 1)).toBe(false);
    suppressor.arm(CLICK_GESTURES.MIDDLE, 1);
    expect(suppressor.suppress("auxclick", 2)).toBe(false);
    expect(suppressor.suppress("contextmenu", 1)).toBe(false);
    expect(suppressor.suppress("auxclick", 1)).toBe(true);
    expect(suppressor.suppress("auxclick", 1)).toBe(false);
    expect(suppressor.suppress("click", 1)).toBe(true);
    // The set is exhausted: the arm self-cleared.
    expect(suppressor.suppress("click", 1)).toBe(false);
  });

  test("suppresses the context menu and auxclick after an armed right press", () => {
    const suppressor = createFollowUpSuppressor();

    suppressor.arm(CLICK_GESTURES.RIGHT, 2);
    expect(suppressor.suppress("contextmenu", 2)).toBe(true);
    expect(suppressor.suppress("auxclick", 2)).toBe(true);
    expect(suppressor.suppress("contextmenu", 2)).toBe(false);
  });

  test.each([
    CLICK_GESTURES.LEFT,
    CLICK_GESTURES.DOUBLE_LEFT,
    CLICK_GESTURES.BACK,
    CLICK_GESTURES.FORWARD,
  ] as const)("%s arms no follow-up suppression", (gesture) => {
    const suppressor = createFollowUpSuppressor();

    suppressor.arm(gesture, 3);
    expect(suppressor.suppress("auxclick", 3)).toBe(false);
    expect(suppressor.suppress("contextmenu", 3)).toBe(false);
    expect(suppressor.suppress("mouseup", 3)).toBe(false);
  });

  test("disarm clears a pending suppression", () => {
    const suppressor = createFollowUpSuppressor();

    suppressor.arm(CLICK_GESTURES.RIGHT, 2);
    suppressor.disarm();
    expect(suppressor.suppress("contextmenu", 2)).toBe(false);
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
