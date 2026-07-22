// History Move spans the background message owner and the download event
// owner. Its intent lives in the persisted per-download record so an MV3
// restart cannot turn an accepted replacement into premature data loss.
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import {
  getDownload,
  mergeDownload,
  mergeDownloadStrict,
  type PendingHistoryMove,
} from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import { undoBrowserDownload } from "./undo-download.ts";

export type CompletedHistoryMove = {
  handled: boolean;
  oldRemoved: boolean;
  newHistoryId?: string;
};

const completionTasks = new Map<number, Promise<CompletedHistoryMove>>();

export const registerPendingHistoryMove = (
  replacementDownloadId: number,
  pending: PendingHistoryMove,
): Promise<unknown> =>
  mergeDownloadStrict(
    downloadsState,
    sessionWriteState,
    extensionSessionStorage,
    replacementDownloadId,
    { pendingHistoryMove: pending },
  );

export const abandonPendingHistoryMove = (replacementDownloadId: number): Promise<unknown> =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, replacementDownloadId, {
    pendingHistoryMove: undefined,
  });

const runPendingHistoryMove = async (
  replacementDownloadId: number,
): Promise<CompletedHistoryMove> => {
  const record = await getDownload(downloadsState, extensionSessionStorage, replacementDownloadId);
  const pending = record?.pendingHistoryMove;
  if (!pending) return { handled: false, oldRemoved: false };

  const removal = await undoBrowserDownload(pending.downloadId, {
    startTime: pending.startTime,
    filename: pending.filename,
  });
  const newHistoryId = record.historyEntryId;
  if (newHistoryId) {
    await downloadPorts.history.patch(newHistoryId, { rerouteOf: pending.historyId });
    await downloadPorts.history.patch(pending.historyId, { rerouteTo: newHistoryId });
  }
  // Publish the terminal moved status only after the relationship is durable;
  // History observers can then treat that status as the completed transaction.
  if (removal.undone) {
    await downloadPorts.history.setStatus(pending.historyId, "moved", pending.downloadId);
  }
  await abandonPendingHistoryMove(replacementDownloadId);
  return {
    handled: true,
    oldRemoved: removal.undone,
    ...(newHistoryId ? { newHistoryId } : {}),
  };
};

export const completePendingHistoryMove = (
  replacementDownloadId: number,
): Promise<CompletedHistoryMove> => {
  const active = completionTasks.get(replacementDownloadId);
  if (active) return active;
  const task = runPendingHistoryMove(replacementDownloadId);
  completionTasks.set(replacementDownloadId, task);
  const retire = () => {
    completionTasks.delete(replacementDownloadId);
  };
  // A caller observes the task's rejection. Give both outcomes an explicit
  // retirement handler instead of ignoring finally()'s second rejected
  // promise, which would surface as an unhandled worker rejection.
  void task.then(retire, retire);
  return task;
};
