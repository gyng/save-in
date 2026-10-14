import {
  browserConflictAction,
  conflictResolutionFor,
  isConflictActionAvailable,
} from "../../src/shared/conflict-action.ts";
import type { ConflictAction } from "../../src/shared/constants.ts";

const FIREFOX = { conflictActionPrompt: false, conflictRenameDetection: true };
const CHROME = { conflictActionPrompt: true, conflictRenameDetection: false };
// A browser with neither, such as an unknown host: only native actions survive.
const NEITHER = { conflictActionPrompt: false, conflictRenameDetection: false };

// [stored, capabilities, value handed to downloads API, Save In resolution, available]
const MATRIX: Array<
  [ConflictAction, typeof FIREFOX, string, "skip" | "ask" | null, boolean, string]
> = [
  ["uniquify", FIREFOX, "uniquify", null, true, "Firefox uniquify is unchanged"],
  ["overwrite", FIREFOX, "overwrite", null, true, "Firefox overwrite is unchanged"],
  ["prompt", FIREFOX, "uniquify", "ask", true, "Firefox emulates prompt"],
  ["skip", FIREFOX, "uniquify", "skip", true, "Firefox skips"],
  ["uniquify", CHROME, "uniquify", null, true, "Chrome uniquify is unchanged"],
  ["overwrite", CHROME, "overwrite", null, true, "Chrome overwrite is unchanged"],
  ["prompt", CHROME, "prompt", null, true, "Chrome keeps its native prompt"],
  ["skip", CHROME, "uniquify", null, false, "Chrome cannot skip"],
  ["prompt", NEITHER, "uniquify", null, false, "no prompt at all"],
  ["skip", NEITHER, "uniquify", null, false, "no skip at all"],
];

test.each(MATRIX)(
  "%s with %o: native %s, resolution %s, available %s (%s)",
  (stored, capabilities, native, resolution, available) => {
    expect(browserConflictAction(stored, capabilities)).toBe(native);
    expect(conflictResolutionFor(stored, capabilities)).toBe(resolution);
    expect(isConflictActionAvailable(stored, capabilities)).toBe(available);
  },
);
