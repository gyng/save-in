import { webExtensionApi } from "../platform/web-extension-api.ts";
import { BROWSERS, CURRENT_BROWSER } from "../platform/chrome-detector.ts";
import { proposedFilename } from "./browser-downloads.ts";

export type UndoDownloadResult = { undone: boolean; fileMissing: boolean };

// What the caller knows about the download it intends to undo, from the
// History entry or the per-download session record. Undo refuses to act when
// the browser's record contradicts the evidence — or when there is none.
export type ExpectedDownloadIdentity = {
  startTime?: string | undefined;
  url?: string | undefined;
  filename?: string | undefined;
};

// The browser resolves an on-disk filename collision by inserting "(n)"
// before the extension — Chrome with a leading space, Firefox without one.
// History keeps the pre-collision routed name, so only the browser item's
// basename may carry the suffix, and only in the host's own format: on
// Chrome a spaceless "(n)" is never browser-inserted (it is part of the
// routed name), and on Firefox a spaced " (n)" is not either. Stripping the
// foreign format would let a genuine "(n)" name match an unrelated entry.
const withoutUniquifySuffix = (name: string): string =>
  CURRENT_BROWSER === BROWSERS.FIREFOX
    ? name.replace(/(?<! )\(\d+\)(?=(?:\.[^.]*)?$)/, "")
    : name.replace(/ \(\d+\)(?=(?:\.[^.]*)?$)/, "");

// A stored path ending in a separator names a directory, not a file; taking
// its last real segment would make "a/foo/" match any file named "foo", so
// such paths compare whole.
const comparableFilename = (path: string): string =>
  /[\\/]$/.test(path) ? path : proposedFilename(path);

// startTime is the one browser-assigned field that survives redirects,
// blob/data-URL acquisition, and filename uniquification, so when both sides
// know it, it alone decides. The field arms exist for legacy entries stored
// before startTime was captured: url must match one side of a redirect
// exactly, filenames compare by basename (history stores the routed path,
// the browser the absolute on-disk path). No evidence at all must refuse —
// Firefox downloads-API ids are session-scoped, so a bare id proves nothing.
export const matchesDownloadIdentity = (
  item: {
    startTime?: string | undefined;
    url?: string | undefined;
    finalUrl?: string | undefined;
    filename?: string | undefined;
  },
  expected: ExpectedDownloadIdentity,
): boolean => {
  const { startTime, url, filename } = expected;
  if (startTime && item.startTime) return item.startTime === startTime;
  if (!url && !filename) return false;
  if (url && (item.url === url || item.finalUrl === url)) return true;
  if (filename && item.filename) {
    const itemBase = comparableFilename(item.filename);
    const expectedBase = comparableFilename(filename);
    if (itemBase === expectedBase) return true;
    if (withoutUniquifySuffix(itemBase) === expectedBase) return true;
  }
  return false;
};

// Callers bind a downloadId to a history entry at several points but do not
// always hold the DownloadItem; the identity check wants its startTime.
export const searchDownloadStartTime = async (downloadId: number): Promise<string | undefined> => {
  try {
    const [item] = await webExtensionApi.downloads.search({ id: downloadId });
    return item?.startTime;
  } catch {
    return undefined;
  }
};

// The event-path bind (onDownloadCreated's matched expected record) supplies
// the startTime for free, but it can lose its race against
// cancelExpectedDownload, and an entry left without its anchor degrades undo
// to the weaker field rules. This late write stays off the launch hot path,
// and the anchor callback must be guarded: it applies only while the entry
// still points at this download and lacks a startTime, because a fetch retry
// may have rebound the entry to a replacement download in the meantime and a
// late write of the dead original would misdirect undo and progress.
export const backfillDownloadStartTime = (
  entryId: string,
  downloadId: number,
  anchor: (entryId: string, downloadId: number, startTime: string) => Promise<unknown>,
): void => {
  void searchDownloadStartTime(downloadId)
    .then((startTime) => (startTime ? anchor(entryId, downloadId, startTime) : undefined))
    .catch(() => {});
};

// Undoing a save removes the file and erases the browser's shelf entry, in
// that order — erase first would drop the browser's record of the file path.
// The History entry is marked by the caller, never deleted, so the user keeps
// an auditable "undone" row.
//
// The search-first identity check is load-bearing: Firefox downloads-API ids
// are session-scoped while Save In history persists them across restarts, so
// a stale id can name a different user's-file entirely. Extensions also
// cannot stat the filesystem, so when the browser no longer tracks the id
// (or tracks a different download under it) the file's fate is unknowable —
// undo must refuse rather than destroy the wrong file or claim success.
// Non-destructive half of the undo check, shared with reroute: reroute must
// prove the original is verifiable BEFORE issuing the replacement download,
// or an unverifiable row would spawn a duplicate file it can never clean up.
export const findVerifiedDownload = async (
  downloadId: number,
  expected: ExpectedDownloadIdentity = {},
): Promise<{ id: number; exists?: boolean | undefined } | null> => {
  let item;
  try {
    [item] = await webExtensionApi.downloads.search({ id: downloadId });
  } catch {
    return null;
  }
  if (!item) return null;
  if (!matchesDownloadIdentity(item, expected)) return null;
  return item;
};

export const undoBrowserDownload = async (
  downloadId: number,
  expected: ExpectedDownloadIdentity = {},
): Promise<UndoDownloadResult> => {
  const item = await findVerifiedDownload(downloadId, expected);
  if (!item) return { undone: false, fileMissing: false };

  // Success needs at least one confirmed fact: the browser reported the file
  // gone, removeFile resolved, or erase actually erased. A removeFile
  // rejection alone is a claim, not confirmation — the download can vanish
  // between the identity search and the undo, and then nothing was done.
  let fileMissing = item.exists === false;
  let confirmed = fileMissing;
  if (!fileMissing) {
    try {
      await webExtensionApi.downloads.removeFile(downloadId);
      confirmed = true;
    } catch {
      // removeFile rejects when the file was already moved or deleted
      // out-of-band; the shelf entry and the History mark must still happen,
      // but callers surface the difference to the user.
      fileMissing = true;
    }
  }
  try {
    // The search above already proved the download was real, so an empty
    // erase result after a confirmed removal only means the shelf entry
    // vanished concurrently — the undo's goal state holds either way.
    const erased = await webExtensionApi.downloads.erase({ id: downloadId });
    if (erased.length > 0) confirmed = true;
  } catch {
    return { undone: false, fileMissing };
  }
  if (!confirmed) return { undone: false, fileMissing: false };
  return { undone: true, fileMissing };
};

// The "mark undone only after the undo actually succeeded" pairing must stay
// identical between the History message handler and the notification button;
// downloads/ cannot import background/history directly (import-cycle rule),
// so the mark arrives as a callback.
export const undoDownloadAndMark = async (
  downloadId: number,
  expected: ExpectedDownloadIdentity,
  markUndone: () => Promise<unknown>,
): Promise<UndoDownloadResult> => {
  const result = await undoBrowserDownload(downloadId, expected);
  if (result.undone) await markUndone();
  return result;
};
