// History Move spans the background message owner and the download event
// owner. Its intent lives in the persisted per-download record so an MV3
// restart cannot turn an accepted replacement into premature data loss.
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { getDownload, mergeDownload, type PendingHistoryMove } from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import { undoBrowserDownload } from "./undo-download.ts";

export const registerPendingHistoryMove = (
  replacementDownloadId: number,
  pending: PendingHistoryMove,
): Promise<unknown> =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, replacementDownloadId, {
    pendingHistoryMove: pending,
  });

export const abandonPendingHistoryMove = (replacementDownloadId: number): Promise<unknown> =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, replacementDownloadId, {
    pendingHistoryMove: undefined,
  });

export const completePendingHistoryMove = async (
  replacementDownloadId: number,
): Promise<{ handled: boolean; oldRemoved: boolean; newHistoryId?: string }> => {
  const record = await getDownload(downloadsState, extensionSessionStorage, replacementDownloadId);
  const pending = record?.pendingHistoryMove;
  if (!pending) return { handled: false, oldRemoved: false };

  const removal = await undoBrowserDownload(pending.downloadId, {
    startTime: pending.startTime,
    filename: pending.filename,
  });
  if (removal.undone) {
    await downloadPorts.history.setStatus(pending.historyId, "moved", pending.downloadId);
  }
  const newHistoryId = record.historyEntryId;
  if (newHistoryId) {
    await downloadPorts.history.patch(newHistoryId, { rerouteOf: pending.historyId });
    await downloadPorts.history.patch(pending.historyId, { rerouteTo: newHistoryId });
  }
  await abandonPendingHistoryMove(replacementDownloadId);
  return {
    handled: true,
    oldRemoved: removal.undone,
    ...(newHistoryId ? { newHistoryId } : {}),
  };
};
