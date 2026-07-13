import { webExtensionApi } from "../platform/web-extension-api.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { getSession, normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { hydrateDownloads, mergeDownload } from "./download-state.ts";
import { PENDING_DOWNLOADS_SESSION_KEY } from "../shared/storage-keys.ts";

const PENDING_RECOVERY_GRACE_MS = 10000;
let recovery: Promise<void> | null = null;

const reconcileAdoptedDownloads = async () => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  const adoptedIds: number[] = [];
  downloadsState.records.forEach((record, id) => {
    if (record?.adopted) adoptedIds.push(id);
  });

  if (adoptedIds.length === 0) return;
  // A terminal downloads.onChanged event may be the event that woke this
  // worker. Give its synchronously registered handler time to consume the
  // adopted record before pruning records whose browser download is no longer
  // live. Otherwise startup recovery can suppress the completion event.
  setTimeout(() => {
    void Promise.all(
      adoptedIds.map(async (id) => {
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
  }, PENDING_RECOVERY_GRACE_MS);
};

const reconcilePendingDownloads = async () => {
  const res = await getSession<number>(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY);
  const staleAtStartup = normalizeSessionCounter(res[PENDING_DOWNLOADS_SESSION_KEY]);
  if (staleAtStartup > 0) {
    setTimeout(() => {
      updateSession<number>(
        sessionWriteState,
        extensionSessionStorage,
        PENDING_DOWNLOADS_SESSION_KEY,
        (n) => Math.max(0, normalizeSessionCounter(n) - staleAtStartup),
      );
    }, PENDING_RECOVERY_GRACE_MS);
  }
};

export const recoverNotificationState = (): Promise<void> => {
  recovery ??= Promise.all([reconcileAdoptedDownloads(), reconcilePendingDownloads()])
    .then(() => undefined)
    .catch((error) => {
      recovery = null;
      throw error;
    });
  return recovery;
};
