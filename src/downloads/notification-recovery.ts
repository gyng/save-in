import { webExtensionApi } from "../platform/web-extension-api.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import {
  getSession,
  normalizeSessionCounter,
  readSessionToUpdate,
  removeSession,
  setSession,
} from "../shared/session-state.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";
import {
  NOTIFICATION_RECOVERY_SESSION_KEY,
  PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { hydrateDownloads, mergeDownload } from "./download-state.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { downloadPorts } from "./ports.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { abandonPendingHistoryMove, completePendingHistoryMove } from "./history-move.ts";

const PENDING_RECOVERY_GRACE_MS = 10000;

type NotificationRecovery = {
  version: 1;
  token: string;
  deadline: number;
  pendingDownloads: number;
  adoptedDownloadIds: number[];
};

let recovery: Promise<void> | null = null;
const recoveryTimers = new Set<ReturnType<typeof setTimeout>>();
const recoveryTasks = new Set<Promise<void>>();

const normalizeRecovery = (value: unknown): NotificationRecovery | null => {
  if (!isStringKeyedRecord(value)) return null;
  const candidate = value;
  if (
    candidate.version !== 1 ||
    typeof candidate.token !== "string" ||
    typeof candidate.deadline !== "number" ||
    !Number.isSafeInteger(candidate.deadline) ||
    !Array.isArray(candidate.adoptedDownloadIds)
  ) {
    return null;
  }
  return {
    version: 1,
    token: candidate.token,
    deadline: candidate.deadline,
    pendingDownloads: normalizeSessionCounter(candidate.pendingDownloads),
    adoptedDownloadIds: candidate.adoptedDownloadIds.filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
    ),
  };
};

const sameRecovery = (left: NotificationRecovery, right: NotificationRecovery): boolean =>
  left.token === right.token;

const readRecovery = async (): Promise<NotificationRecovery | null> => {
  const stored = await getSession(extensionSessionStorage, NOTIFICATION_RECOVERY_SESSION_KEY);
  return normalizeRecovery(stored[NOTIFICATION_RECOVERY_SESSION_KEY]);
};

const queuePendingRecovery = (expected: NotificationRecovery): Promise<void> => {
  const prior = sessionWriteState.queues.get(PENDING_DOWNLOADS_SESSION_KEY) ?? Promise.resolve();
  const queued = prior.then(async () => {
    const [pendingStored, current] = await Promise.all([
      // The read half of this read-modify-write, so it must not degrade to {}:
      // the count is the minuend, and rebasing it onto nothing subtracts the
      // recovered downloads from 0 and writes that over the real total.
      readSessionToUpdate(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY),
      readRecovery(),
    ]);
    if (!current || !sameRecovery(current, expected) || current.pendingDownloads === 0) return;
    const pending = normalizeSessionCounter(pendingStored[PENDING_DOWNLOADS_SESSION_KEY]);
    await setSession(
      extensionSessionStorage,
      {
        [PENDING_DOWNLOADS_SESSION_KEY]: Math.max(0, pending - current.pendingDownloads),
        [NOTIFICATION_RECOVERY_SESSION_KEY]: { ...current, pendingDownloads: 0 },
      },
      `${PENDING_DOWNLOADS_SESSION_KEY},${NOTIFICATION_RECOVERY_SESSION_KEY}`,
    );
  });
  // The read above can now reject, and this promise is both awaited by the
  // recovery flow and parked in the shared queue. Contain it exactly as
  // updateSession does: skip the write, record the failure, settle — so the
  // rejection neither fails recovery nor is chained onto by the next write.
  const settled = queued.catch((error: unknown) => {
    recordPersistenceFailure(
      { area: "session", operation: "update", key: PENDING_DOWNLOADS_SESSION_KEY },
      error,
    );
  });
  sessionWriteState.queues.set(PENDING_DOWNLOADS_SESSION_KEY, settled);
  void settled.finally(() => {
    if (sessionWriteState.queues.get(PENDING_DOWNLOADS_SESSION_KEY) === settled) {
      sessionWriteState.queues.delete(PENDING_DOWNLOADS_SESSION_KEY);
    }
  });
  return settled;
};

const reconcileAdoptedDownloads = async (expected: NotificationRecovery) => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  await Promise.all(
    expected.adoptedDownloadIds.map(async (id) => {
      if (!downloadsState.records.get(id)?.adopted) return;
      let item:
        | {
            state?: string | undefined;
            error?: string | undefined;
            fileSize?: number | undefined;
            totalBytes?: number | undefined;
          }
        | undefined;
      try {
        [item] = await webExtensionApi.downloads.search({ id });
      } catch {
        // A missing/forgotten download is stale too.
      }
      if (item?.state === "in_progress") return;
      const record = downloadsState.records.get(id);
      if (record?.historyEntryId) {
        if (item?.state === "complete") {
          const bytes = (item.fileSize ?? 0) > 0 ? item.fileSize : item.totalBytes;
          await downloadPorts.history.setStatus(
            record.historyEntryId,
            "complete",
            id,
            (bytes ?? 0) > 0 ? bytes : undefined,
          );
          await completePendingHistoryMove(id);
        } else {
          await downloadPorts.history.setStatus(
            record.historyEntryId,
            item?.error || "DOWNLOAD_STATE_LOST",
            id,
          );
          await abandonPendingHistoryMove(id);
        }
      }
      if (record?.offscreenRequestId) {
        await OffscreenClient.release(record.offscreenRequestId).catch(() => {});
      }
      await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, id, {
        adopted: false,
      });
    }),
  );
};

const finishRecovery = async (expected: NotificationRecovery): Promise<void> => {
  await queuePendingRecovery(expected);
  await reconcileAdoptedDownloads(expected);
  const current = await readRecovery();
  if (current && sameRecovery(current, expected)) {
    await removeSession(extensionSessionStorage, NOTIFICATION_RECOVERY_SESSION_KEY);
  }
};

const scheduleRecovery = (expected: NotificationRecovery, delay: number): void => {
  const timer = setTimeout(
    () => {
      recoveryTimers.delete(timer);
      const task = finishRecovery(expected);
      recoveryTasks.add(task);
      void task.then(
        () => recoveryTasks.delete(task),
        () => recoveryTasks.delete(task),
      );
    },
    Math.max(0, delay),
  );
  recoveryTimers.add(timer);
};

const initializeRecovery = async (): Promise<void> => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  const [pendingStored, storedRecovery] = await Promise.all([
    getSession(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY),
    readRecovery(),
  ]);
  const pendingDownloads = normalizeSessionCounter(pendingStored[PENDING_DOWNLOADS_SESSION_KEY]);
  const adoptedDownloadIds = [...downloadsState.records]
    .filter(([, record]) => record.adopted)
    .map(([id]) => id);

  let expected = storedRecovery;
  if (!expected && (pendingDownloads > 0 || adoptedDownloadIds.length > 0)) {
    expected = {
      version: 1,
      token: `${Date.now()}-${Math.random()}`,
      deadline: Date.now() + PENDING_RECOVERY_GRACE_MS,
      pendingDownloads,
      adoptedDownloadIds,
    };
    await setSession(extensionSessionStorage, {
      [NOTIFICATION_RECOVERY_SESSION_KEY]: expected,
    });
  } else if (expected) {
    const adoptedIds = new Set(expected.adoptedDownloadIds);
    adoptedDownloadIds.forEach((id) => adoptedIds.add(id));
    const merged: NotificationRecovery = {
      ...expected,
      adoptedDownloadIds: [...adoptedIds],
    };
    if (merged.adoptedDownloadIds.length !== expected.adoptedDownloadIds.length) {
      expected = merged;
      await setSession(extensionSessionStorage, {
        [NOTIFICATION_RECOVERY_SESSION_KEY]: expected,
      });
    }
  }
  if (!expected) return;

  const delay = Math.min(PENDING_RECOVERY_GRACE_MS, expected.deadline - Date.now());
  if (delay > 0) {
    scheduleRecovery(expected, delay);
    return;
  }

  // Pending state must expire before an unrelated onCreated event can consume
  // it. Adopted records wait for the next task so an onChanged event that woke
  // this background can consume its own record first.
  await queuePendingRecovery(expected);
  scheduleRecovery(expected, 0);
};

export const recoverNotificationState = (): Promise<void> => {
  recovery ??= initializeRecovery();
  return recovery;
};

export const resetNotificationRecoveryState = async (): Promise<void> => {
  for (const timer of recoveryTimers) clearTimeout(timer);
  recoveryTimers.clear();
  await Promise.allSettled(recoveryTasks);
  recoveryTasks.clear();
  recovery = null;
};
