import { describe, expect, test, vi } from "vitest";
import { CLICK_GESTURES } from "../../src/shared/click-gesture.ts";
import {
  createDoubleClickTracker,
  createFollowUpSuppressor,
  createLongClickReleaseSuppressor,
  createLongPressTracker,
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
    CLICK_GESTURES.LONG_LEFT,
    CLICK_GESTURES.BACK,
    CLICK_GESTURES.FORWARD,
  ] as const)("%s arms no follow-up suppression", (gesture) => {
    const suppressor = createFollowUpSuppressor();

    suppressor.arm(gesture, 3);
    expect(suppressor.suppress("auxclick", 3)).toBe(false);
    expect(suppressor.suppress("contextmenu", 3)).toBe(false);
    expect(suppressor.suppress("mouseup", 3)).toBe(false);
  });

  test("completes a long press through one scheduled timer", () => {
    let scheduled: (() => void) | undefined;
    const clear = vi.fn();
    const complete = vi.fn();
    const tracker = createLongPressTracker(
      500,
      {
        set: (callback, delay) => {
          expect(delay).toBe(500);
          scheduled = callback;
          return 7;
        },
        clear,
      },
      complete,
    );

    tracker.press("source", 10, 20);
    expect(tracker.isPending()).toBe(true);
    scheduled?.();

    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith("source");
    expect(tracker.isPending()).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  test("cancels outside the movement slop but permits movement on its boundary", () => {
    const scheduled = new Map<number, () => void>();
    let nextTimer = 0;
    const complete = vi.fn();
    const tracker = createLongPressTracker(
      500,
      {
        set: (callback) => {
          nextTimer += 1;
          scheduled.set(nextTimer, callback);
          return nextTimer;
        },
        clear: (timer) => scheduled.delete(timer),
      },
      complete,
    );

    tracker.press("within", 0, 0);
    tracker.move(8, 0);
    scheduled.get(1)?.();
    expect(complete).toHaveBeenCalledWith("within");

    tracker.press("outside", 0, 0);
    tracker.move(8, 1);
    scheduled.get(2)?.();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(tracker.isPending()).toBe(false);
  });

  test("a release or replacement press clears the previous timer", () => {
    const clear = vi.fn();
    let nextTimer = 0;
    const tracker = createLongPressTracker(
      500,
      {
        set: () => {
          nextTimer += 1;
          return nextTimer;
        },
        clear,
      },
      vi.fn(),
    );

    tracker.press("first", 0, 0);
    tracker.press("second", 0, 0);
    tracker.cancel();

    expect(clear.mock.calls).toEqual([[1], [2]]);
    expect(tracker.isPending()).toBe(false);
  });

  test("long-click release suppression ignores keyboard clicks and expires after release", () => {
    const scheduled = new Map<number, () => void>();
    let nextTimer = 0;
    const suppressor = createLongClickReleaseSuppressor(5000, {
      set: (callback, delay) => {
        expect(delay).toBe(5000);
        nextTimer += 1;
        scheduled.set(nextTimer, callback);
        return nextTimer;
      },
      clear: (timer) => scheduled.delete(timer),
    });

    suppressor.arm();
    expect(suppressor.consume(0)).toBe(false);
    suppressor.release();
    expect(suppressor.consume(1)).toBe(true);
    expect(scheduled.size).toBe(0);

    suppressor.arm();
    suppressor.release();
    scheduled.get(2)?.();
    expect(suppressor.consume(1)).toBe(false);
  });

  test("a stale release-expiry callback cannot clear a newer hold", () => {
    const scheduled: Array<() => void> = [];
    const suppressor = createLongClickReleaseSuppressor(5000, {
      set: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      // Model a callback that was already queued when cancellation raced it.
      clear: vi.fn(),
    });

    suppressor.arm();
    suppressor.release();
    suppressor.arm();
    scheduled[0]?.();

    expect(suppressor.consume(1)).toBe(true);
  });

  test("a repeated release restarts the suppression grace period", () => {
    const clear = vi.fn();
    let nextTimer = 0;
    const suppressor = createLongClickReleaseSuppressor(5000, {
      set: () => {
        nextTimer += 1;
        return nextTimer;
      },
      clear,
    });

    suppressor.arm();
    suppressor.release();
    suppressor.release();

    expect(clear).toHaveBeenCalledWith(1);
  });

  test("ignores a stale scheduled callback after cancellation", () => {
    let scheduled: (() => void) | undefined;
    const complete = vi.fn();
    const tracker = createLongPressTracker(
      500,
      {
        set: (callback) => {
          scheduled = callback;
          return 1;
        },
        // Model a timer callback that was already queued when cancellation
        // raced it; the state guard remains the final authority.
        clear: vi.fn(),
      },
      complete,
    );

    tracker.press("source", 0, 0);
    tracker.cancel();
    tracker.move(10, 10);
    scheduled?.();

    expect(complete).not.toHaveBeenCalled();
  });

  test("a stale replaced-press callback cannot complete the newer candidate", () => {
    const scheduled: Array<() => void> = [];
    const complete = vi.fn();
    const tracker = createLongPressTracker(
      500,
      {
        set: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        clear: vi.fn(),
      },
      complete,
    );

    tracker.press("first", 0, 0);
    tracker.press("second", 0, 0);
    scheduled[0]?.();
    expect(complete).not.toHaveBeenCalled();
    expect(tracker.isPending()).toBe(true);

    scheduled[1]?.();
    expect(complete).toHaveBeenCalledWith("second");
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
