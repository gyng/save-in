import { DOWNLOAD_TYPES, SKIP_SAVED_SOURCES } from "../shared/constants.ts";

export type SavedSourceCheck = {
  // The stored option value; anything unrecognised reads as "never".
  mode: unknown;
  context: string | undefined;
  // The address the browser would be asked to fetch.
  url: string;
  // A private save while "Remember private browsing activity" is off.
  isolatedPrivate: boolean;
  // The user asked for a Save As dialog for this one save.
  explicitPrompt: boolean;
  // The save deliberately repeats an entry History already holds.
  repeatsSavedSource: boolean;
};

const isHttpUrl = (value: string): boolean => /^https?:/i.test(value);

// The address to look up in History, or null when this save is never declined
// for having been saved before. Kept apart from the lookup so that a save the
// option does not cover costs nothing — not even a History read.
export const savedSourceLookupUrl = (check: SavedSourceCheck): string | null => {
  const covered =
    check.mode === SKIP_SAVED_SOURCES.ALL
      ? // A sidecar is written beside a primary save the user did ask for.
        check.context !== DOWNLOAD_TYPES.SIDECAR
      : check.mode === SKIP_SAVED_SOURCES.AUTOMATIC && check.context === DOWNLOAD_TYPES.AUTO;
  if (!covered) return null;
  // A re-route downloads its own entry again, and a per-save Save As request
  // is the user saying they want this copy.
  if (check.repeatsSavedSource || check.explicitPrompt) return null;
  // An isolated private save leaves no History row of its own, so History
  // could only ever answer for the regular profile's saves. Declining a
  // private save on that evidence would show the private window what the
  // regular one saved; such a save neither reads nor is matched by History.
  if (check.isolatedPrivate) return null;
  // data: and blob: addresses are payloads or process-local handles, not a
  // stable identity two saves could share.
  return isHttpUrl(check.url) ? check.url : null;
};
