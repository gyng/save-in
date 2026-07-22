// History Move spans the background message owner and the download event
// owner. Its intent lives in the persisted per-download record so an MV3
// restart cannot turn an accepted replacement into premature data loss.
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import {
  getDownload,
  mergeDownload,
  mergeDownloadStrict,
  type PendingHistoryMove,
} from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import { removeVerifiedDownloadFile } from "./undo-download.ts";

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

  const newHistoryId = record.historyEntryId;
  if (newHistoryId) {
    // Establish the auditable relationship before touching the old file. A
    // storage failure leaves both copies intact and the durable intent retries.
    await downloadPorts.history.patchStrict(newHistoryId, { rerouteOf: pending.historyId });
    await downloadPorts.history.patchStrict(pending.historyId, { rerouteTo: newHistoryId });
  }
  const oldRemoved = await removeVerifiedDownloadFile(pending.downloadId, {
    startTime: pending.startTime,
    filename: pending.filename,
  });
  if (oldRemoved) {
    // Keep the browser record until this strict write succeeds. Its `exists:
    // false` state is the recovery evidence if the worker or storage fails
    // after removeFile() has already changed the filesystem.
    await downloadPorts.history.setStatusStrict(pending.historyId, "moved", pending.downloadId);
    try {
      await webExtensionApi.downloads.erase({ id: pending.downloadId });
    } catch (error) {
      downloadPorts.log.add("history move shelf cleanup failed", String(error), {
        privateContext: record.privateContext === true,
      });
    }
  }
  await abandonPendingHistoryMove(replacementDownloadId);
  return {
    handled: true,
    oldRemoved,
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
