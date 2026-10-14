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
  PRIVATE_PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { hydrateDownloads } from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { abandonPendingHistoryMove, completePendingHistoryMove } from "./history-move.ts";
import { releaseTerminalDownload } from "./terminal-download.ts";

const PENDING_RECOVERY_GRACE_MS = 10000;

type NotificationRecovery = {
  version: 1;
  token: string;
  deadline: number;
  pendingDownloads: number;
  privatePendingDownloads: number;
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
    privatePendingDownloads: normalizeSessionCounter(candidate.privatePendingDownloads),
    adoptedDownloadIds: [
      ...new Set(
        candidate.adoptedDownloadIds.filter(
          (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
        ),
      ),
    ],
  };
};

const sameRecovery = (left: NotificationRecovery, right: NotificationRecovery): boolean =>
  left.token === right.token;

const readRecovery = async (): Promise<NotificationRecovery | null> => {
  const stored = await getSession(extensionSessionStorage, NOTIFICATION_RECOVERY_SESSION_KEY);
  return normalizeRecovery(stored[NOTIFICATION_RECOVERY_SESSION_KEY]);
};

type PendingRecoveryCounter =
  | {
      key: typeof PENDING_DOWNLOADS_SESSION_KEY;
      field: "pendingDownloads";
    }
  | {
      key: typeof PRIVATE_PENDING_DOWNLOADS_SESSION_KEY;
      field: "privatePendingDownloads";
    };

// Every read-modify-write of a pending counter and the lease shares the
// counter's session write queue, so recovery and event-time claims serialize.
const queueOnPendingCounter = <T>(
  key: PendingRecoveryCounter["key"],
  fallback: T,
  task: () => Promise<T>,
): Promise<T> => {
  const prior = sessionWriteState.queues.get(key) ?? Promise.resolve();
  // The read inside the task can reject, and this promise is both awaited by
  // its caller and parked in the shared queue. Contain it exactly as
  // updateSession does: skip the write, record the failure, settle — so the
  // rejection neither fails the caller nor is chained onto by the next write.
  const settled = prior.then(task).catch((error: unknown) => {
    recordPersistenceFailure({ area: "session", operation: "update", key }, error);
    return fallback;
  });
  sessionWriteState.queues.set(key, settled);
  void settled.finally(() => {
    if (sessionWriteState.queues.get(key) === settled) {
      sessionWriteState.queues.delete(key);
    }
  });
  return settled;
};

const queuePendingRecovery = (
  expected: NotificationRecovery,
  counter: PendingRecoveryCounter,
): Promise<void> =>
  queueOnPendingCounter(counter.key, undefined, async () => {
    const [pendingStored, current] = await Promise.all([
      // The read half of this read-modify-write, so it must not degrade to {}:
      // the count is the minuend, and rebasing it onto nothing subtracts the
      // recovered downloads from 0 and writes that over the real total.
      readSessionToUpdate(extensionSessionStorage, counter.key),
      readRecovery(),
    ]);
    if (!current || !sameRecovery(current, expected) || current[counter.field] === 0) return;
    const pending = normalizeSessionCounter(pendingStored[counter.key]);
    await setSession(
      extensionSessionStorage,
      {
        [counter.key]: Math.max(0, pending - current[counter.field]),
        [NOTIFICATION_RECOVERY_SESSION_KEY]: { ...current, [counter.field]: 0 },
      },
      `${counter.key},${NOTIFICATION_RECOVERY_SESSION_KEY}`,
    );
  });

// The public counter also counts requests this worker started, which the
// in-memory expected-download list already claims. Only a request inherited
// from a worker that died mid-handoff is unknowable here, and the lease holds
// exactly that number; outside it an unclaimed item is not ours.
export const claimInheritedPendingDownload = (): Promise<boolean> =>
  queueOnPendingCounter(PENDING_DOWNLOADS_SESSION_KEY, false, async () => {
    const [pendingStored, current] = await Promise.all([
      readSessionToUpdate(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY),
      readRecovery(),
    ]);
    const pending = normalizeSessionCounter(pendingStored[PENDING_DOWNLOADS_SESSION_KEY]);
    if (!current || current.pendingDownloads === 0 || pending === 0) return false;
    await setSession(
      extensionSessionStorage,
      {
        [PENDING_DOWNLOADS_SESSION_KEY]: pending - 1,
        [NOTIFICATION_RECOVERY_SESSION_KEY]: {
          ...current,
          pendingDownloads: current.pendingDownloads - 1,
        },
      },
      `${PENDING_DOWNLOADS_SESSION_KEY},${NOTIFICATION_RECOVERY_SESSION_KEY}`,
    );
    return true;
  });

const queueAllPendingRecovery = async (expected: NotificationRecovery): Promise<void> => {
  // Serialize the two writes because both also update the shared lease record.
  await queuePendingRecovery(expected, {
    key: PENDING_DOWNLOADS_SESSION_KEY,
    field: "pendingDownloads",
  });
  await queuePendingRecovery(expected, {
    key: PRIVATE_PENDING_DOWNLOADS_SESSION_KEY,
    field: "privatePendingDownloads",
  });
};

const reconcileAdoptedDownloads = async (expected: NotificationRecovery) => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  await Promise.all(
    expected.adoptedDownloadIds.map(async (id) => {
      const initialRecord = downloadsState.records.get(id);
      if (!initialRecord?.adopted && !initialRecord?.pendingHistoryMove) return;
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
      if (record) {
        if (item?.state === "complete") {
          if (record.historyEntryId) {
            const bytes = (item.fileSize ?? 0) > 0 ? item.fileSize : item.totalBytes;
            await downloadPorts.history.setStatus(
              record.historyEntryId,
              "complete",
              id,
              (bytes ?? 0) > 0 ? bytes : undefined,
            );
          }
          if (record.pendingHistoryMove) await completePendingHistoryMove(id);
        } else {
          if (record.historyEntryId) {
            await downloadPorts.history.setStatus(
              record.historyEntryId,
              item?.error || "DOWNLOAD_STATE_LOST",
              id,
            );
          }
          if (record.pendingHistoryMove) await abandonPendingHistoryMove(id);
        }
      }
      if (record) await releaseTerminalDownload(id, record, () => {});
    }),
  );
};

const finishRecovery = async (expected: NotificationRecovery): Promise<void> => {
  await queueAllPendingRecovery(expected);
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
    getSession(extensionSessionStorage, [
      PENDING_DOWNLOADS_SESSION_KEY,
      PRIVATE_PENDING_DOWNLOADS_SESSION_KEY,
    ]),
    readRecovery(),
  ]);
  const pendingDownloads = normalizeSessionCounter(pendingStored[PENDING_DOWNLOADS_SESSION_KEY]);
  const privatePendingDownloads = normalizeSessionCounter(
    pendingStored[PRIVATE_PENDING_DOWNLOADS_SESSION_KEY],
  );
  const adoptedDownloadIds = [...downloadsState.records]
    .filter(([, record]) => record.adopted || record.pendingHistoryMove)
    .map(([id]) => id);

  let expected = storedRecovery;
  if (
    !expected &&
    (pendingDownloads > 0 || privatePendingDownloads > 0 || adoptedDownloadIds.length > 0)
  ) {
    expected = {
      version: 1,
      token: `${Date.now()}-${Math.random()}`,
      deadline: Date.now() + PENDING_RECOVERY_GRACE_MS,
      pendingDownloads,
      privatePendingDownloads,
      adoptedDownloadIds,
    };
    await setSession(extensionSessionStorage, {
      [NOTIFICATION_RECOVERY_SESSION_KEY]: expected,
    });
  } else if (expected) {
    const adoptedIds = new Set(expected.adoptedDownloadIds);
    adoptedDownloadIds.forEach((id) => adoptedIds.add(id));
    // No event runs before initialization finishes, so the stored counters are
    // the exact anonymous barriers this worker inherited, including requests a
    // previous recovering worker started and then lost. Keeping the old lease
    // count would leave those requests in the counter after expiry, where no
    // later recovery could tell them from a live request.
    const grew =
      pendingDownloads > expected.pendingDownloads ||
      privatePendingDownloads > expected.privatePendingDownloads;
    const merged: NotificationRecovery = {
      ...expected,
      // A request the previous worker started after this lease began has had
      // no grace window of its own yet, so the inherited lease restarts one.
      ...(grew ? { deadline: Date.now() + PENDING_RECOVERY_GRACE_MS } : {}),
      pendingDownloads,
      privatePendingDownloads,
      adoptedDownloadIds: [...adoptedIds],
    };
    if (
      merged.pendingDownloads !== expected.pendingDownloads ||
      merged.privatePendingDownloads !== expected.privatePendingDownloads ||
      merged.adoptedDownloadIds.length !== expected.adoptedDownloadIds.length
    ) {
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
  await queueAllPendingRecovery(expected);
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
