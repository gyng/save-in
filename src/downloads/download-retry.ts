import { webExtensionApi } from "../platform/web-extension-api.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { options } from "../config/options-data.ts";
import { getExtensionFetchCredentials } from "../config/fetch-credentials.ts";
import {
  DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
  fetchFollowingRedirects,
} from "../shared/redirect-fetch.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import { isPrivateDownloadRecord } from "./download-state.ts";
import type { DownloadRecord, PrivateDownloadContext } from "./download-state.ts";
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
    expectDownload(url: string, record?: Partial<DownloadRecord> & PrivateDownloadContext): unknown;
    cancelExpectedDownload(expected: unknown): void;
  };
  log: {
    add(message: string, detail: string, options?: { privateContext?: boolean }): void;
  };
};

const rememberStartedDownload = (
  downloadId: number,
  partial: Partial<DownloadRecord> & PrivateDownloadContext,
) => mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

export const retryViaFetch = async (
  runtime: RetryRuntime,
  services: RetryServices,
  downloadId: number,
  enqueueFilename: (
    map: FinalFilenameMap | undefined,
    url: string,
    filename: string,
  ) => FinalFilenameMap,
  removeFilename: (
    map: FinalFilenameMap | undefined,
    url: string,
    filename: string,
  ) => FinalFilenameMap,
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
  // Persist before fetching so a worker restart cannot retry the same download twice.
  record.retried = true;
  await rememberStartedDownload(downloadId, record);

  let blobUrl: string | undefined;
  let expected: unknown;
  let newId: number | undefined;
  try {
    const response = await fetchFollowingRedirects(
      url,
      { credentials: getExtensionFetchCredentials() },
      DEFAULT_FETCH_RESPONSE_TIMEOUT_MS,
    );
    if (response.ok === false) throw new Error(`HTTP ${response.status}`);
    blobUrl = await makeUrlFromBlob(await response.blob());
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
    newId = await webExtensionApi.downloads.download({
      url: blobUrl,
      filename,
      conflictAction: record.conflictAction,
    });
    services.notifier.cancelExpectedDownload(expected);
    expected = undefined;
    if (blobUrl.startsWith("blob:")) runtime.ownedObjectUrls.set(newId, blobUrl);
    await rememberStartedDownload(
      newId,
      Object.assign({}, record, { viaFetch: true, adopted: true }),
    );
    return true;
  } catch (error) {
    if (expected) services.notifier.cancelExpectedDownload(expected);
    if (blobUrl?.startsWith("blob:") && newId == null) URL.revokeObjectURL(blobUrl);
    if (privateContext) {
      services.log.add("fallback fetch failed", String(error), { privateContext: true });
    } else services.log.add("fallback fetch failed", String(error));
    return false;
  } finally {
    if (blobUrl && !privateContext) {
      runtime.pendingRetryFilenames.delete(blobUrl);
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
