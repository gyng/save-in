import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { downloadsState, sessionWriteState } from "./download-state-instances.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { options, shouldPersistActivity } from "../config/options-data.ts";
import { resolveFirefoxDownloadContext } from "./auth-context.ts";
import { fetchUrlForDownload } from "./content-fetch.ts";
import { getFetchReferer } from "./headers.ts";
import {
  finishActiveTransfer,
  holdTransferKeepalive,
  registerActiveTransfer,
  releaseTransferKeepalive,
  updateActiveTransfer,
} from "./active-transfers.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import { downloadPorts } from "./ports.ts";
import { backfillDownloadStartTime } from "./undo-download.ts";
import { beginAnonymousPrivateDownloadGuard } from "./private-download-guard.ts";
import { isPrivateDownloadRecord } from "./download-state.ts";
import type { DownloadRecordUpdate } from "./download-state.ts";
import {
  FINAL_FILENAMES_SESSION_KEY,
  PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";

// Mirrors downloads/filename-listener.ts, which owns the shape and its version
// stamp; this layer only hands the map back through the injected helpers, so it
// stays structural rather than importing across the seam.
type FinalFilenameMap = { version: number; names: Record<string, string | string[]> };

export type RetryRuntime = {
  pendingRetryFilenames: Map<string, string>;
  ownedObjectUrls: Map<number, string>;
};

export type RetryServices = {
  notifier: {
    expectDownload(url: string, record?: DownloadRecordUpdate): unknown;
    cancelExpectedDownload(expected: unknown): void;
  };
  log: {
    add(message: string, detail: string, options?: { privateContext?: boolean }): void;
  };
};

const rememberStartedDownload = (downloadId: number, partial: DownloadRecordUpdate) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

export const retryViaFetch = async (
  runtime: RetryRuntime,
  services: RetryServices,
  downloadId: number,
  enqueueFilename: (map: unknown, url: string, filename: string) => FinalFilenameMap,
  removeFilename: (map: unknown, url: string, filename: string) => FinalFilenameMap,
): Promise<boolean> => {
  const record = await getDownload(downloadsState, extensionSessionStorage, downloadId);
  if (
    !record ||
    record.retried ||
    record.viaFetch ||
    options.fallbackFetch === false ||
    !record.url ||
    !record.filename
  ) {
    return false;
  }

  const { filename, url } = record;
  // Re-derive Referer protection from the persisted record so a retry of a
  // protected download is not the one request that arrives without it. This
  // re-checks the live option and filter rather than trusting stale state.
  const retryReferer = getFetchReferer({ info: { url, pageUrl: record.pageUrl } });
  // `allowOriginalUrlFallback` is false when the download carried a Referer
  // natively (Firefox) or when its address is not HTTP(S). It exists to bar
  // promptOnFailure, which re-requests the original URL bare — a hotlink
  // -protected host rejects that. This retry is not bare: it fetches under DNR
  // Referer protection, so it stays viable exactly while that Referer can still
  // be carried. blob:/data: addresses never match the Referer filter, so they
  // yield no Referer here and stay barred.
  if (record.allowOriginalUrlFallback === false && !retryReferer) return false;
  const privateContext = isPrivateDownloadRecord(record);
  // A retained History id proves the original private save was admitted while
  // the opt-in was enabled. Preserve that save's restart-safe retry even if the
  // user has since disabled admission for new private activity.
  const persistActivity =
    shouldPersistActivity(privateContext) || typeof record.historyEntryId === "string";
  const controller = new AbortController();
  const requestId = crypto.randomUUID();
  if (record.historyEntryId) {
    registerActiveTransfer(record.historyEntryId, controller, { requestId });
  } else {
    holdTransferKeepalive(controller);
  }
  // Persist before fetching so a worker restart cannot retry the same download twice.
  record.retried = true;
  await rememberStartedDownload(downloadId, record);

  let blobUrl: string | undefined;
  let expected: unknown;
  let newId: number | undefined;
  let offscreenRequestId: string | undefined;
  let releasePrivateDownloadGuard: (() => Promise<void>) | null = null;
  try {
    const content = await fetchUrlForDownload(
      url,
      privateContext,
      controller.signal,
      requestId,
      retryReferer,
    );
    const downloadUrl = content.downloadUrl;
    blobUrl = downloadUrl;
    offscreenRequestId = content.offscreenRequestId;
    runtime.pendingRetryFilenames.set(downloadUrl, filename);
    releasePrivateDownloadGuard = await beginAnonymousPrivateDownloadGuard(
      privateContext,
      persistActivity,
    );
    expected = services.notifier.expectDownload(downloadUrl, {
      privateContext,
      ...(record.sourceSidecar === true ? { sourceSidecar: true } : {}),
      // Carry the pending sidecar so a completion merged from the provisional
      // record (before rememberStartedDownload persists the full one) still
      // writes the source shortcut for a retried save.
      ...(record.pendingSourceSidecar ? { pendingSourceSidecar: record.pendingSourceSidecar } : {}),
      // Carry the history entry so onDownloadCreated's matched branch rebinds
      // the entry to the replacement id with the item's startTime for free —
      // the replacement is a different browser download, and the dead
      // original's startTime would refuse undo of the retried save.
      ...(record.historyEntryId ? { historyEntryId: record.historyEntryId } : {}),
      ...(record.pendingHistoryMove ? { pendingHistoryMove: record.pendingHistoryMove } : {}),
    });
    await Promise.all(
      persistActivity
        ? [
            updateSession<number>(
              sessionWriteState,
              extensionSessionStorage,
              PENDING_DOWNLOADS_SESSION_KEY,
              (n) => normalizeSessionCounter(n) + 1,
            ),
            updateSession<FinalFilenameMap>(
              sessionWriteState,
              extensionSessionStorage,
              FINAL_FILENAMES_SESSION_KEY,
              (m) => enqueueFilename(m, downloadUrl, filename),
            ),
          ]
        : [],
    );
    const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
      url: downloadUrl,
      filename,
      conflictAction: record.conflictAction,
    };
    Object.assign(
      downloadOptions,
      await resolveFirefoxDownloadContext({ incognito: privateContext }),
    );
    newId = await webExtensionApi.downloads.download(downloadOptions);
    services.notifier.cancelExpectedDownload(expected);
    expected = undefined;
    if (content.ownedObjectUrl) runtime.ownedObjectUrls.set(newId, content.ownedObjectUrl);
    if (record.historyEntryId) {
      updateActiveTransfer(record.historyEntryId, { downloadId: newId });
      // The expected record carries historyEntryId, so the event path rebinds
      // id and startTime when it wins its race against cancelExpectedDownload
      // above. This direct bind covers the losing order, and stays off the
      // await chain so a fast replacement's completion still finds the record
      // persisted by rememberStartedDownload below. A different-id bind
      // without a time clears the dead original's stale anchor.
      void downloadPorts.history.setDownloadId(record.historyEntryId, newId).catch(() => {});
      backfillDownloadStartTime(
        record.historyEntryId,
        newId,
        downloadPorts.history.anchorStartTime,
      );
    }
    await rememberStartedDownload(
      newId,
      Object.assign({}, record, {
        viaFetch: true,
        adopted: true,
        ...(offscreenRequestId ? { offscreenRequestId } : {}),
      }),
    );
    // An abort landing after the replacement was accepted is still handled,
    // exactly as one landing before it resolves. The caller reports the
    // original browser failure for an unhandled retry, which would overwrite
    // the USER_CANCELED the cancel just wrote and tell the user their own
    // cancel failed.
    if (controller.signal.aborted) {
      await webExtensionApi.downloads.cancel(newId).catch(() => {});
    }
    return true;
  } catch (error) {
    if (expected) services.notifier.cancelExpectedDownload(expected);
    if (blobUrl?.startsWith("blob:") && newId == null && !offscreenRequestId) {
      URL.revokeObjectURL(blobUrl);
    }
    if (offscreenRequestId && newId == null) {
      await OffscreenClient.release(offscreenRequestId).catch(() => {});
    }
    if (controller.signal.aborted) return true;
    if (privateContext) {
      services.log.add("fallback fetch failed", String(error), { privateContext: true });
    } else services.log.add("fallback fetch failed", String(error));
    return false;
  } finally {
    if (record.historyEntryId) finishActiveTransfer(record.historyEntryId, controller);
    else releaseTransferKeepalive(controller);
    const cleanupUrl = blobUrl;
    // Only Chrome's onDeterminingFilename consumes a queued name. Firefox
    // never registers that listener, so there the retry must clear both
    // mirrors itself or the entry outlives the session, keyed by a dead blob
    // URL.
    const filenameListenerWillConsume =
      newId != null && WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
    if (cleanupUrl && !filenameListenerWillConsume) {
      runtime.pendingRetryFilenames.delete(cleanupUrl);
    }
    const cleanup: Promise<unknown>[] = [];
    if (cleanupUrl && persistActivity) {
      cleanup.push(
        updateSession<number>(
          sessionWriteState,
          extensionSessionStorage,
          PENDING_DOWNLOADS_SESSION_KEY,
          (n) => Math.max(0, normalizeSessionCounter(n) - 1),
        ),
      );
      // A successful downloads.download() can resolve before Chrome dispatches
      // onDeterminingFilename. Keep the restart-safe filename queued until the
      // listener consumes it; deleting it here races Chrome and produces a
      // root-level file named "download". Rejected starts have no future
      // listener, so clean their queue entry immediately.
      if (!filenameListenerWillConsume) {
        cleanup.push(
          updateSession<FinalFilenameMap>(
            sessionWriteState,
            extensionSessionStorage,
            FINAL_FILENAMES_SESSION_KEY,
            (m) => removeFilename(m, cleanupUrl, filename),
          ),
        );
      }
    }
    if (releasePrivateDownloadGuard) cleanup.push(releasePrivateDownloadGuard());
    await Promise.all(cleanup);
  }
};
