import { webExtensionApi } from "../platform/web-extension-api.ts";
import { downloadsState, sessionWriteState } from "./state.ts";
import { normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { options } from "../config/options-data.ts";
import { makeUrlFromBlob } from "./content-fetch.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import type { DownloadRecord } from "./download-state.ts";
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
    expectDownload(url: string): unknown;
    cancelExpectedDownload(expected: unknown): void;
  };
  log: { add(message: string, detail: string): void };
};

const rememberStartedDownload = (downloadId: number, partial: Partial<DownloadRecord>) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

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
  // Persist before fetching so a worker restart cannot retry the same download twice.
  record.retried = true;
  await rememberStartedDownload(downloadId, record);

  let blobUrl: string | undefined;
  let expected: unknown;
  let newId: number | undefined;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (response.ok === false) throw new Error(`HTTP ${response.status}`);
    blobUrl = await makeUrlFromBlob(await response.blob());
    runtime.pendingRetryFilenames.set(blobUrl, filename);
    expected = services.notifier.expectDownload(blobUrl);
    await Promise.all([
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
    ]);
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
    services.log.add("fallback fetch failed", String(error));
    return false;
  } finally {
    if (blobUrl) {
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
