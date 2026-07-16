import { webExtensionApi } from "../platform/web-extension-api.ts";

export type UndoDownloadResult = { undone: boolean; fileMissing: boolean };

// Undoing a save removes the file and erases the browser's shelf entry, in
// that order — erase first would drop the browser's record of the file path.
// The History entry is marked by the caller, never deleted, so the user keeps
// an auditable "undone" row.
export const undoBrowserDownload = async (downloadId: number): Promise<UndoDownloadResult> => {
  let fileMissing = false;
  try {
    await webExtensionApi.downloads.removeFile(downloadId);
  } catch {
    // removeFile rejects when the file was already moved or deleted
    // out-of-band; the shelf entry and the History mark must still happen,
    // but callers surface the difference to the user.
    fileMissing = true;
  }
  try {
    await webExtensionApi.downloads.erase({ id: downloadId });
  } catch {
    return { undone: false, fileMissing };
  }
  return { undone: true, fileMissing };
};
