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
