import { webExtensionApi } from "../platform/web-extension-api.ts";
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

// The browser resolves an on-disk filename collision by inserting " (n)"
// before the extension; history keeps the pre-collision routed name, so only
// the browser item's basename may carry the suffix.
const withoutUniquifySuffix = (name: string): string =>
  name.replace(/ \(\d+\)(?=(?:\.[^.]*)?$)/, "");

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
    const itemBase = proposedFilename(item.filename);
    const expectedBase = proposedFilename(filename);
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
export const undoBrowserDownload = async (
  downloadId: number,
  expected: ExpectedDownloadIdentity = {},
): Promise<UndoDownloadResult> => {
  let item;
  try {
    [item] = await webExtensionApi.downloads.search({ id: downloadId });
  } catch {
    return { undone: false, fileMissing: false };
  }
  if (!item) return { undone: false, fileMissing: false };
  if (!matchesDownloadIdentity(item, expected)) return { undone: false, fileMissing: false };

  let fileMissing = item.exists === false;
  if (!fileMissing) {
    try {
      await webExtensionApi.downloads.removeFile(downloadId);
    } catch {
      // removeFile rejects when the file was already moved or deleted
      // out-of-band; the shelf entry and the History mark must still happen,
      // but callers surface the difference to the user.
      fileMissing = true;
    }
  }
  try {
    // The search above already proved the download is real, so an empty erase
    // result only means the shelf entry vanished concurrently — the undo's
    // goal state (file handled, shelf entry gone) holds either way. Only a
    // rejection is a failure.
    await webExtensionApi.downloads.erase({ id: downloadId });
  } catch {
    return { undone: false, fileMissing };
  }
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
