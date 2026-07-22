import { CLICK_GESTURES, type ClickGesture } from "../shared/click-gesture.ts";

const SINGLE_GESTURE_BUTTONS: Partial<Record<ClickGesture, number>> = {
  [CLICK_GESTURES.LEFT]: 0,
  [CLICK_GESTURES.MIDDLE]: 1,
  [CLICK_GESTURES.RIGHT]: 2,
  [CLICK_GESTURES.BACK]: 3,
  [CLICK_GESTURES.FORWARD]: 4,
};

export const isSingleGestureButton = (gesture: ClickGesture, button: number): boolean =>
  SINGLE_GESTURE_BUTTONS[gesture] === button;

// Canceling the matched mousedown does not cancel the browser action that the
// same input sequence triggers later: the context menu opens from
// `contextmenu`, and a middle-click link opens from the default action of
// `auxclick` (`click` is included for engines that historically routed middle
// clicks there). Back/forward have no entry: their history navigation is
// browser-level, and neither browser exposes a cancelable content event for it
// (measured per browser in content.ts, next to the mousedown handler).
const GESTURE_FOLLOW_UP_EVENTS: Partial<Record<ClickGesture, readonly string[]>> = {
  [CLICK_GESTURES.MIDDLE]: ["auxclick", "click"],
  [CLICK_GESTURES.RIGHT]: ["contextmenu", "auxclick"],
};

// One-shot per matched mousedown: armed only when a configured gesture
// matched, consumes each follow-up event type at most once, and self-clears
// when the set is exhausted. Callers disarm on every new mousedown and on
// focus/visibility resets so a stale arm can never leak onto later input.
export const createFollowUpSuppressor = () => {
  let armedButton = -1;
  let pending: ReadonlySet<string> = new Set();
  return {
    arm(gesture: ClickGesture, button: number): void {
      pending = new Set(GESTURE_FOLLOW_UP_EVENTS[gesture] ?? []);
      armedButton = pending.size > 0 ? button : -1;
    },
    disarm(): void {
      pending = new Set();
      armedButton = -1;
    },
    suppress(type: string, button: number): boolean {
      if (button !== armedButton || !pending.has(type)) return false;
      const remaining = new Set(pending);
      remaining.delete(type);
      pending = remaining;
      if (remaining.size === 0) armedButton = -1;
      return true;
    },
  };
};

export const createDoubleClickTracker = <Candidate>(
  sameCandidate: (first: Candidate, second: Candidate) => boolean,
) => {
  let first: Candidate | null = null;
  return {
    press(detail: number, button: number, candidate: Candidate): boolean {
      if (button !== 0) {
        first = null;
        return false;
      }
      if (detail === 1) {
        first = candidate;
        return false;
      }
      if (detail === 2 && first && sameCandidate(first, candidate)) {
        first = null;
        return true;
      }
      first = null;
      return false;
    },
    reset(): void {
      first = null;
    },
  };
};

const LONG_PRESS_MOVEMENT_SLOP_PX = 8;

type LongPressScheduler = {
  set: (callback: () => void, delayMs: number) => number;
  clear: (timer: number) => void;
};

export const createLongPressTracker = <Candidate>(
  delayMs: number,
  scheduler: LongPressScheduler,
  complete: (candidate: Candidate) => void,
) => {
  let pending: { candidate: Candidate; x: number; y: number; timer: number } | null = null;

  const cancel = (): void => {
    if (!pending) return;
    scheduler.clear(pending.timer);
    pending = null;
  };

  return {
    press(candidate: Candidate, x: number, y: number): void {
      cancel();
      const timer = scheduler.set(() => {
        const current = pending;
        pending = null;
        if (current) complete(current.candidate);
      }, delayMs);
      pending = { candidate, x, y, timer };
    },
    move(x: number, y: number): void {
      if (!pending) return;
      const deltaX = x - pending.x;
      const deltaY = y - pending.y;
      if (
        deltaX * deltaX + deltaY * deltaY >
        LONG_PRESS_MOVEMENT_SLOP_PX * LONG_PRESS_MOVEMENT_SLOP_PX
      ) {
        cancel();
      }
    },
    cancel,
    isPending: (): boolean => pending !== null,
  };
};
