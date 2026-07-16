import { webExtensionApi } from "../platform/web-extension-api.ts";

export type UndoDownloadResult = { undone: boolean; fileMissing: boolean };

// What the caller knows about the download it intends to undo, from the
// History entry or the per-download session record. Undo refuses to act when
// the browser's record contradicts every provided field.
export type ExpectedDownloadIdentity = {
  url?: string | undefined;
  filename?: string | undefined;
};

const basename = (path: string): string => {
  const segments = path.split(/[\\/]/);
  // A trailing separator yields an empty last segment; compare the full path
  // then rather than treating every such pair as equal.
  return segments[segments.length - 1] || path;
};

// Lenient on purpose: history stores the routed path while the browser item
// holds the absolute on-disk path (separators differ by platform), and a
// redirect can leave the entry's url on either side of item.url/finalUrl.
// Any agreeing field is proof enough; refusing requires every provided field
// to disagree.
export const matchesDownloadIdentity = (
  item: { url?: string | undefined; finalUrl?: string | undefined; filename?: string | undefined },
  expected: ExpectedDownloadIdentity,
): boolean => {
  const expectedUrl = expected.url;
  const expectedFilename = expected.filename;
  if (!expectedUrl && !expectedFilename) return true;
  if (expectedUrl && (item.url === expectedUrl || item.finalUrl === expectedUrl)) return true;
  if (expectedFilename && item.filename && basename(item.filename) === basename(expectedFilename)) {
    return true;
  }
  return false;
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
    // erase resolves with the erased ids and never rejects for a
    // non-matching query, so an empty result is a failure, not a success.
    const erased = await webExtensionApi.downloads.erase({ id: downloadId });
    if (erased.length === 0) return { undone: false, fileMissing };
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
