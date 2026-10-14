// Shared because the option schema (config/), the options page (options/) and
// the download pipeline (downloads/) must agree on which stored conflict action
// a browser can carry out, and none of those layers may import another's copy.
import { CONFLICT_ACTION, type ConflictAction } from "./constants.ts";

// The conflict actions a browser's downloads API accepts. "skip" exists only in
// Save In, and Firefox has never implemented "prompt" (Bugzilla 1425515).
export type BrowserConflictAction = Exclude<ConflictAction, typeof CONFLICT_ACTION.SKIP>;

export type ConflictCapabilities = {
  conflictActionPrompt: boolean;
  conflictRenameDetection: boolean;
};

// What Save In does itself after the browser reveals a name conflict.
export type ConflictResolution = "skip" | "ask";

export const browserConflictAction = (
  action: ConflictAction,
  capabilities: ConflictCapabilities,
): BrowserConflictAction => {
  if (action === CONFLICT_ACTION.SKIP) return CONFLICT_ACTION.UNIQUIFY;
  if (action === CONFLICT_ACTION.PROMPT && !capabilities.conflictActionPrompt) {
    return CONFLICT_ACTION.UNIQUIFY;
  }
  return action;
};

// Native prompt wins where the browser has one; detection only emulates it.
export const conflictResolutionFor = (
  action: ConflictAction,
  capabilities: ConflictCapabilities,
): ConflictResolution | null => {
  if (!capabilities.conflictRenameDetection) return null;
  if (action === CONFLICT_ACTION.SKIP) return "skip";
  if (action === CONFLICT_ACTION.PROMPT && !capabilities.conflictActionPrompt) return "ask";
  return null;
};

// Whether a stored action can run in this browser; anything else loads as the
// default rather than failing every save.
export const isConflictActionAvailable = (
  action: ConflictAction,
  capabilities: ConflictCapabilities,
): boolean => {
  if (action === CONFLICT_ACTION.SKIP) return capabilities.conflictRenameDetection;
  if (action === CONFLICT_ACTION.PROMPT) {
    return capabilities.conflictActionPrompt || capabilities.conflictRenameDetection;
  }
  return true;
};
