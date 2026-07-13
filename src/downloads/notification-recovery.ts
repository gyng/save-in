import { webExtensionApi } from "../platform/web-extension-api.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { getSession, normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { hydrateDownloads, mergeDownload } from "./download-state.ts";

const PENDING_RECOVERY_GRACE_MS = 10000;

const reconcileAdoptedDownloads = async () => {
  await hydrateDownloads(downloadsState, extensionSessionStorage);
  const adoptedIds: number[] = [];
  downloadsState.records.forEach((record, id) => {
    if (record?.adopted) adoptedIds.push(id);
  });

  await Promise.all(
    adoptedIds.map(async (id) => {
      try {
        const [item] = await webExtensionApi.downloads.search({ id });
        if (!item || item.state === "complete") {
          await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, id, {
            adopted: false,
          });
        }
      } catch {
        await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, id, {
          adopted: false,
        });
      }
    }),
  );
};

const reconcilePendingDownloads = async () => {
  const res = await getSession<number>(extensionSessionStorage, "siPendingDownloads");
  const staleAtStartup = normalizeSessionCounter(res.siPendingDownloads);
  if (staleAtStartup > 0) {
    setTimeout(() => {
      updateSession<number>(sessionWriteState, extensionSessionStorage, "siPendingDownloads", (n) =>
        Math.max(0, normalizeSessionCounter(n) - staleAtStartup),
      );
    }, PENDING_RECOVERY_GRACE_MS);
  }
};

export const notifierReady = Promise.all([
  reconcileAdoptedDownloads(),
  reconcilePendingDownloads(),
]);
