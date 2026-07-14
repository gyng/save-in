import { webExtensionApi } from "../platform/web-extension-api.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { options } from "../config/options-data.ts";
import { resolveFirefoxDownloadContext } from "./auth-context.ts";
import { fetchUrlForDownload } from "./content-fetch.ts";
import { ActiveTransfers } from "./active-transfers.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import { isPrivateDownloadRecord } from "./download-state.ts";
import type { DownloadRecordUpdate } from "./download-state.ts";
import {
  FINAL_FILENAMES_SESSION_KEY,
  PENDING_DOWNLOADS_SESSION_KEY,
} from "../shared/storage-keys.ts";

type FinalFilenameMap = Record<string, string | string[]>;

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
    record.allowOriginalUrlFallback === false ||
    options.fallbackFetch === false ||
    !record.url ||
    !record.filename
  ) {
    return false;
  }

  const { filename, url } = record;
  const privateContext = isPrivateDownloadRecord(record);
  const controller = new AbortController();
  const requestId = crypto.randomUUID();
  if (record.historyEntryId) {
    ActiveTransfers.register(record.historyEntryId, controller, { requestId });
  } else {
    ActiveTransfers.hold(controller);
  }
  // Persist before fetching so a worker restart cannot retry the same download twice.
  record.retried = true;
  await rememberStartedDownload(downloadId, record);

  let blobUrl: string | undefined;
  let expected: unknown;
  let newId: number | undefined;
  let offscreenRequestId: string | undefined;
  try {
    const content = await fetchUrlForDownload(url, privateContext, controller.signal, requestId);
    blobUrl = content.downloadUrl;
    offscreenRequestId = content.offscreenRequestId;
    runtime.pendingRetryFilenames.set(blobUrl, filename);
    expected = services.notifier.expectDownload(blobUrl, { privateContext });
    await Promise.all(
      privateContext
        ? []
        : [
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
              (m) => enqueueFilename(m, blobUrl!, filename),
            ),
          ],
    );
    const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
      url: blobUrl,
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
    if (record.historyEntryId) ActiveTransfers.update(record.historyEntryId, { downloadId: newId });
    await rememberStartedDownload(
      newId,
      Object.assign({}, record, {
        viaFetch: true,
        adopted: true,
        ...(offscreenRequestId ? { offscreenRequestId } : {}),
      }),
    );
    if (controller.signal.aborted) {
      await webExtensionApi.downloads.cancel(newId).catch(() => {});
      return false;
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
    if (record.historyEntryId) ActiveTransfers.finish(record.historyEntryId, controller);
    else ActiveTransfers.release(controller);
    if (blobUrl) {
      const filenameListenerWillConsume =
        newId != null && WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion;
      if (!filenameListenerWillConsume) runtime.pendingRetryFilenames.delete(blobUrl);
    }
    if (blobUrl && !privateContext) {
      const cleanup: Promise<unknown>[] = [
        updateSession<number>(
          sessionWriteState,
          extensionSessionStorage,
          PENDING_DOWNLOADS_SESSION_KEY,
          (n) => Math.max(0, normalizeSessionCounter(n) - 1),
        ),
      ];
      // A successful downloads.download() can resolve before Chrome dispatches
      // onDeterminingFilename. Keep the restart-safe filename queued until the
      // listener consumes it; deleting it here races Chrome and produces a
      // root-level file named "download". Rejected starts have no future
      // listener, so clean their queue entry immediately.
      if (newId == null) {
        cleanup.push(
          updateSession<FinalFilenameMap>(
            sessionWriteState,
            extensionSessionStorage,
            FINAL_FILENAMES_SESSION_KEY,
            (m) => removeFilename(m, blobUrl!, filename),
          ),
        );
      }
      await Promise.all(cleanup);
    }
  }
};
