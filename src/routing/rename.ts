// The rename: clause edits the final filename component after every variable
// and capture has expanded and after disposition-filename resolution, but
// before truncation and sanitization. It deliberately never goes through
// Path: the directory part stays untouched, and any separator the replacement
// introduces is sanitized later as an ordinary filename character.
import { isStringKeyedRecord } from "../shared/util.ts";
import { SPECIAL_DIRS } from "../shared/constants.ts";
import type { RoutingDownloadInfo } from "./rule-types.ts";
import { expandVariableTemplate } from "./variable.ts";

// The raw separator between the find regex and the literal replacement. A
// pattern that needs a literal " -> " sequence writes part of it with regex
// escapes (e.g. `\x20->`) so the raw clause text never contains the separator.
export const RENAME_SEPARATOR = " -> ";

// Serializable through storage.session (Chrome's deferred filename
// resolution can outlive the worker), so the find regex stays source+flags.
export type RenameTransform = {
  find: string;
  flags: string;
  replacement: string;
};

export const splitRenameValue = (raw: string): { find: string; replacement: string } | null => {
  const separator = raw.indexOf(RENAME_SEPARATOR);
  if (separator < 0) return null;
  return {
    find: raw.slice(0, separator),
    replacement: raw.slice(separator + RENAME_SEPARATOR.length),
  };
};

export const isRenameTransform = (value: unknown): value is RenameTransform =>
  isStringKeyedRecord(value) &&
  typeof value.find === "string" &&
  typeof value.flags === "string" &&
  typeof value.replacement === "string";

export const renameReplacementNeedsContent = (replacement: string): boolean =>
  replacement.includes(SPECIAL_DIRS.SHA256) || replacement.includes(SPECIAL_DIRS.SHA256_FULL);

// Unlike fetch:, the replacement may use metadata-dependent variables
// (:mime:, :sha256:, …): by the time the final filename settles, the download
// pipeline has already resolved (or can lazily resolve) that metadata for the
// URL actually being downloaded.
export const expandRenameTransform = async (
  transform: RenameTransform,
  info: RoutingDownloadInfo,
): Promise<RenameTransform> => ({
  ...transform,
  replacement: await expandVariableTemplate(transform.replacement, info),
});

// The expanded replacement is literal text: a function replacer keeps
// String.replace from interpreting `$&`/`$1` sequences a variable or capture
// may have introduced. Deleting the whole name falls back to "_" (the same
// convention sanitizeFilename uses) so a later extension append cannot turn
// the result into a dotfile.
export const applyRenameTransform = (component: string, transform: RenameTransform): string => {
  let find: RegExp;
  try {
    find = new RegExp(transform.find, transform.flags);
  } catch {
    // A stale stored transform (edited rules, older profile) must never break
    // the download; the component keeps its resolved name.
    return component;
  }
  const renamed = component.replace(find, () => transform.replacement);
  return renamed === "" && component !== "" ? "_" : renamed;
};
