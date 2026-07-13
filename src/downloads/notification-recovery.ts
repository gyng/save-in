import { webExtensionApi } from "../platform/web-extension-api.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import {
  getSession,
  normalizeSessionCounter,
  removeSession,
  setSession,
} from "../shared/session-state.ts";
import {
  NOTIFICATION_RECOVERY_SESSION_KEY,
  PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { hydrateDownloads, mergeDownload } from "./download-state.ts";

const PENDING_RECOVERY_GRACE_MS = 10000;

type NotificationRecovery = {
  version: 1;
  token: string;
  deadline: number;
  pendingDownloads: number;
  adoptedDownloadIds: number[];
};

let recovery: Promise<void> | null = null;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;

const normalizeRecovery = (value: unknown): NotificationRecovery | null => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    typeof candidate.token !== "string" ||
    typeof candidate.deadline !== "number" ||
    !Number.isFinite(candidate.deadline) ||
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
  const queued = prior
    .then(async () => {
      const [pendingStored, current] = await Promise.all([
        getSession(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY),
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
    })
    .catch(() => {});
  sessionWriteState.queues.set(PENDING_DOWNLOADS_SESSION_KEY, queued);
  void queued.finally(() => {
    if (sessionWriteState.queues.get(PENDING_DOWNLOADS_SESSION_KEY) === queued) {
      sessionWriteState.queues.delete(PENDING_DOWNLOADS_SESSION_KEY);
    }
  });
  return queued;
};

const reconcileAdoptedDownloads = async (expected: NotificationRecovery) => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  await Promise.all(
    expected.adoptedDownloadIds.map(async (id) => {
      if (!downloadsState.records.get(id)?.adopted) return;
      try {
        const [item] = await webExtensionApi.downloads.search({ id });
        if (item?.state === "in_progress") return;
      } catch {
        // A missing/forgotten download is stale too.
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
  if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(
    () => {
      recoveryTimer = undefined;
      void finishRecovery(expected);
    },
    Math.max(0, delay),
  );
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

  const delay = expected.deadline - Date.now();
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
  recovery ??= initializeRecovery().catch((error) => {
    recovery = null;
    throw error;
  });
  return recovery;
};
