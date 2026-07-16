import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

import {
  cancelExpectedDownload,
  expectDownload,
  findExpectedDownload,
  getTrackedDownload,
  mergeTrackedDownload,
} from "./expected-downloads.ts";
import { isPrivateDownloadRecord } from "./download-state.ts";
import type { DownloadRecord } from "./download-state.ts";
import { sessionWriteState } from "./download-state-instances.ts";
import { getSession, normalizeSessionCounter, updateSession } from "../shared/session-state.ts";
import { options } from "../config/options-data.ts";
import { PENDING_DOWNLOADS_SESSION_KEY } from "../shared/storage-keys.ts";
import {
  BROWSERS,
  CURRENT_BROWSER,
  WEB_EXTENSION_CAPABILITIES,
} from "../platform/chrome-detector.ts";
import {
  BrowserDownloadRouting,
  isOrdinaryBrowserDownload,
  isReroutableBrowserDownload,
  matchesBrowserDownloadFilter,
} from "./browser-downloads.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import { downloadPorts } from "./ports.ts";
import {
  buildSuccessNotificationTitle,
  downloadFailureReason,
  getDownloadFailure as isDownloadFailure,
  isRetryableDownloadFailure,
} from "./notification-model.ts";
import {
  createNotification,
  ERROR_ICON_URL,
  EXTENSION_NOTIFICATION_STREAMS,
} from "./notification-runtime.ts";
import { resolveFirefoxDownloadContext } from "./auth-context.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
import { undoDownloadAndMark, type ExpectedDownloadIdentity } from "./undo-download.ts";

type HostDownloadItem = Parameters<
  Parameters<typeof webExtensionApi.downloads.onCreated.addListener>[0]
>[0];
type HostDownloadDelta = Parameters<
  Parameters<typeof webExtensionApi.downloads.onChanged.addListener>[0]
>[0];

// Chrome's notifications API can reject SVG iconUrl values with "Unable to
// download all specified images". Use the shipped raster app icon for the
// native notification surface; status remains explicit in the title and the
// SVG variants remain available to HTML UI where vector images are reliable.
const SUCCESS_ICON_URL = "icons/ic_archive_black_128px.png";

const historyPort = downloadPorts.history;
const logPort = downloadPorts.log;
const backgroundRuntime = downloadPorts.runtime;

const addDownloadLog = (record: DownloadRecord, message: string, data?: unknown): unknown =>
  isPrivateDownloadRecord(record)
    ? logPort.add(message, data, { privateContext: true })
    : logPort.add(message, data);

// Handlers are registered once at load, by registerNotifier in notification.ts:
// MV3 workers must register listeners synchronously or they miss the very
// event that woke them. Notifier options are read from the shared `options`
// global at event time, after awaiting init.
export const onDownloadCreated = async (item: HostDownloadItem) => {
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready.catch(() => {});
  }

  // Never adopt a download another extension initiated — a leaked pending
  // count must not track it as ours and fire a spurious notification. Only a
  // KNOWN-different byExtensionId is rejected: our own downloads may not have
  // byExtensionId populated yet at onCreated (Chrome), so an absent id is left
  // to the counters below.
  if (
    item.byExtensionId &&
    webExtensionApi.runtime &&
    item.byExtensionId !== webExtensionApi.runtime.id
  ) {
    return;
  }

  const finalUrlValue: unknown = Reflect.get(item, "finalUrl");
  const finalUrl = typeof finalUrlValue === "string" ? finalUrlValue : undefined;
  const matched = findExpectedDownload(item.url, finalUrl);
  // Private ordinary downloads are neither tracked nor experimentally
  // replaced. Save In-owned private downloads are handled by the in-memory
  // expected record below, without writing their metadata to storage.session.
  if (item.incognito && !isPrivateDownloadRecord(matched?.record || {})) return;
  if (matched) {
    cancelExpectedDownload(matched);
    const observedBrowserDownload = matched.record?.observedBrowserDownload === true;
    await mergeTrackedDownload(item.id, {
      ...matched.record,
      adopted: !observedBrowserDownload,
      currentFilename: item.filename,
      url: item.url,
      privateContext: item.incognito === true || isPrivateDownloadRecord(matched.record || {}),
    });
    if (matched.record?.historyEntryId) {
      void historyPort.setDownloadId(matched.record.historyEntryId, item.id);
    }
    return;
  }

  // The in-memory counter is lost if the MV3 service worker restarted
  // between requesting the download and this event. siPendingDownloads is a
  // COUNTER (not a boolean) so several downloads created after one restart
  // are all recovered — a boolean dropped every one past the first.
  const res = await getSession(extensionSessionStorage, PENDING_DOWNLOADS_SESSION_KEY);
  if (normalizeSessionCounter(res[PENDING_DOWNLOADS_SESSION_KEY]) > 0) {
    await mergeTrackedDownload(item.id, {
      adopted: true,
      currentFilename: item.filename,
      url: item.url,
    });
    await updateSession<number>(
      sessionWriteState,
      extensionSessionStorage,
      PENDING_DOWNLOADS_SESSION_KEY,
      (n) => Math.max(0, normalizeSessionCounter(n) - 1),
    );
    return;
  }

  const ordinaryBrowserDownload = isOrdinaryBrowserDownload(item, webExtensionApi.runtime?.id);
  const browserDownloadUrl = finalUrl || item.url;
  if (
    !ordinaryBrowserDownload ||
    !matchesBrowserDownloadFilter(
      browserDownloadUrl,
      options.browserDownloadFilter,
      options.browserDownloadExcludeFilter,
      options.browserDownloadFiltersEnabled,
    )
  ) {
    return;
  }

  if (
    CURRENT_BROWSER === BROWSERS.FIREFOX &&
    !WEB_EXTENSION_CAPABILITIES.downloadFilenameSuggestion &&
    options.routeBrowserDownloadsFirefox &&
    isReroutableBrowserDownload(item)
  ) {
    const filename = await BrowserDownloadRouting.route(item);
    if (filename) {
      const historyEntryId = historyPort.add(
        {
          timestamp: new Date().toISOString(),
          url: browserDownloadUrl,
          finalFullPath: filename,
          routed: true,
          mechanism: "firefox-replacement",
          info: { context: "browser" },
        },
        { privateContext: item.incognito === true },
      );
      const expected = expectDownload(browserDownloadUrl, {
        observedBrowserDownload: true,
        adopted: false,
        filename,
        url: browserDownloadUrl,
        ...(historyEntryId ? { historyEntryId } : {}),
        allowOriginalUrlFallback: false,
      });
      try {
        await webExtensionApi.downloads.cancel(item.id);
        await webExtensionApi.downloads.erase({ id: item.id }).catch(() => {});
        const replacementId = await webExtensionApi.downloads.download({
          url: browserDownloadUrl,
          filename,
          conflictAction: options.conflictAction,
        });
        setTimeout(() => cancelExpectedDownload(expected), 10000);
        void historyPort.setDownloadId(historyEntryId, replacementId);
      } catch (error) {
        cancelExpectedDownload(expected);
        await historyPort.setStatus(historyEntryId, "FIREFOX_REROUTE_FAILED");
        logPort.add("Firefox browser download reroute failed", String(error));
      }
      return;
    }
  }

  if (options.trackBrowserDownloads) {
    const historyEntryId = historyPort.add(
      {
        timestamp: new Date().toISOString(),
        url: browserDownloadUrl,
        finalFullPath: item.filename,
        routed: false,
        mechanism: "browser-download",
        info: { context: "browser" },
      },
      { privateContext: item.incognito === true },
    );
    await mergeTrackedDownload(item.id, {
      observedBrowserDownload: true,
      adopted: false,
      currentFilename: item.filename,
      url: browserDownloadUrl,
      ...(historyEntryId ? { historyEntryId } : {}),
      allowOriginalUrlFallback: false,
    });
    void historyPort.setDownloadId(historyEntryId, item.id);
  }
};

// Undo is the only button the success notification carries (Chrome-only; see
// registerNotifier). The notification ID is the download ID, same contract as
// onNotificationClicked below.
export const onNotificationButtonClicked = async (notId: string, buttonIndex: number) => {
  if (buttonIndex !== 0) return;
  if (!/^(0|[1-9]\d*)$/.test(notId)) return;
  const downloadId = Number(notId);
  if (!Number.isSafeInteger(downloadId)) return;
  const record = await getTrackedDownload(downloadId);
  // The session record can be evicted between completion and the click; fall
  // back to the History entry by downloadId so the row is still marked and
  // the identity check still has something to verify against.
  let historyEntryId = record?.historyEntryId;
  let expected: ExpectedDownloadIdentity = { url: record?.url, filename: record?.filename };
  if (!historyEntryId) {
    const entry = (await historyPort.entries()).find(
      (candidate) => candidate.downloadId === downloadId,
    );
    if (entry?.id) {
      historyEntryId = entry.id;
      expected = { url: entry.url, filename: entry.finalFullPath };
    }
  }
  const entryToMark = historyEntryId;
  const result = await undoDownloadAndMark(downloadId, expected, async () => {
    if (entryToMark) {
      await historyPort.setStatus(entryToMark, "undone", downloadId);
      return;
    }
    // Chrome ids are stable across sessions, so the undo itself is safe; only
    // the History mark has nothing to attach to.
    logPort.add("undo could not mark history", { downloadId });
  });
  if (result.undone) {
    await Promise.resolve(webExtensionApi.notifications.clear(notId)).catch(() => {});
  }
};

export const onNotificationClicked = (notId: string) => {
  if (notId === `save-in-not-${EXTENSION_NOTIFICATION_STREAMS.EXTERNAL_DOWNLOAD_REJECTION}`) {
    return webExtensionApi.runtime.openOptionsPage();
  }
  if (String(notId).startsWith("save-in-not-")) {
    return;
  }

  // notification ID should be set to download ID on download creation
  if (!/^(0|[1-9]\d*)$/.test(notId)) return;
  const downloadId = Number(notId);
  if (!Number.isSafeInteger(downloadId)) return;
  return webExtensionApi.downloads.show(downloadId);
};

export const onDownloadChanged = async (downloadDelta: HostDownloadDelta) => {
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready.catch(() => {});
  }

  const notifyOnSuccess = options && options.notifyOnSuccess;
  const notifyOnFailure = options && options.notifyOnFailure;
  const notifyDuration = options && options.notifyDuration;
  const promptOnFailure = options && options.promptOnFailure;

  {
    // The record IS the membership check: no record (or one whose adoption was
    // cleared at a prior terminal delta) means this download is not ours. After
    // a worker restart the in-memory mirror is gone, so this falls back to the
    // persisted copy — that is how a mid-restart download keeps its notification.
    const record = await getTrackedDownload(downloadDelta.id);

    if (!record) {
      return;
    }

    if (record.observedBrowserDownload) {
      const currentFilename = downloadDelta.filename?.current;
      if (currentFilename && record.historyEntryId) {
        await mergeTrackedDownload(downloadDelta.id, { currentFilename });
        await historyPort.patch(record.historyEntryId, { finalFullPath: currentFilename });
      }
      const complete = downloadDelta.state?.current === "complete";
      const failed = isDownloadFailure(
        downloadDelta,
        WEB_EXTENSION_CAPABILITIES.downloadDeltaFilename,
      );
      if (complete || failed) {
        let fileSize: number | undefined;
        if (complete) {
          try {
            const [item] = await webExtensionApi.downloads.search({ id: downloadDelta.id });
            const bytes = item && (item.fileSize > 0 ? item.fileSize : item.totalBytes);
            fileSize = bytes !== undefined && bytes > 0 ? bytes : undefined;
          } catch {
            // Completion remains valid when size lookup is unavailable.
          }
        }
        await historyPort.setStatus(
          record.historyEntryId,
          complete ? "complete" : downloadFailureReason(failed) || "failed",
          downloadDelta.id,
          fileSize,
        );
        await mergeTrackedDownload(downloadDelta.id, { observedBrowserDownload: false });
      }
      return;
    }

    if (!record.adopted) {
      return;
    }

    // CHROME
    // Chrome does not have the filename in the initial DownloadItem,
    // so extract it from the DownloadDelta
    if (WEB_EXTENSION_CAPABILITIES.downloadDeltaFilename) {
      if (downloadDelta && downloadDelta.filename && downloadDelta.filename.current) {
        record.currentFilename = downloadDelta.filename.current;
        await mergeTrackedDownload(downloadDelta.id, {
          currentFilename: downloadDelta.filename.current,
        });
      }
    }

    // Filename can be missing on entries restored after a service worker
    // restart until a filename delta arrives; fall back to the intended path
    const fullFilename = record.currentFilename || record.filename || "";
    const slashIdx = fullFilename.lastIndexOf("/");
    const filename = fullFilename.substring(slashIdx + 1);

    const failed = isDownloadFailure(
      downloadDelta,
      WEB_EXTENSION_CAPABILITIES.downloadDeltaFilename,
    );

    const isFromSelf = record.adopted === true;
    const isUserCancelled = downloadDelta.error && downloadDelta.error.current === "USER_CANCELED";
    const completed = isFromSelf && downloadDelta.state?.current === "complete" && !isUserCancelled;

    // Record the final outcome against the history entry (independent of
    // whether success/failure notifications are enabled)
    const recordHistoryStatus = async (status: string) => {
      // Read from memory, or the persisted copy if the worker restarted since
      // the download started (so a mid-restart download still gets its status)
      const started = await getTrackedDownload(downloadDelta.id);
      if (!started || !started.historyEntryId) return;
      if (status === "complete") {
        try {
          const items = await webExtensionApi.downloads.search({ id: downloadDelta.id });
          const item = items && items[0];
          const size = item ? (item.fileSize > 0 ? item.fileSize : item.totalBytes) : 0;
          await historyPort.setStatus(
            started.historyEntryId,
            status,
            downloadDelta.id,
            size > 0 ? size : undefined,
          );
        } catch {
          await historyPort.setStatus(started.historyEntryId, status, downloadDelta.id);
        }
        return;
      }
      await historyPort.setStatus(started.historyEntryId, status, downloadDelta.id);
    };

    if (isFromSelf && isUserCancelled) {
      await recordHistoryStatus("USER_CANCELED");
    }

    if (completed) {
      await recordHistoryStatus("complete");
    }

    // Deliberately write the source shortcut only after the media download
    // completes: it is named from the resolved on-disk filename (which does
    // not exist until completion), and a shortcut beside media that never
    // saved would be an orphan. A failed save intentionally writes no sidecar.
    if (completed && record.pendingSourceSidecar) {
      try {
        await downloadPorts.sourceSidecar(
          record.pendingSourceSidecar,
          record.filename || "",
          record.currentFilename,
        );
      } catch (error) {
        addDownloadLog(record, "source sidecar failed", String(error));
      } finally {
        await mergeTrackedDownload(downloadDelta.id, { pendingSourceSidecar: undefined });
      }
    }

    if (backgroundRuntime.debug && !isPrivateDownloadRecord(record)) {
      /* eslint-disable no-console */
      console.log("notification", failed, isFromSelf, record, downloadDelta, notifyOnSuccess);
      /* eslint-enable no-console */
    }

    if (isFromSelf && failed && !isUserCancelled) {
      addDownloadLog(record, "download failed", {
        id: downloadDelta.id,
        error: downloadFailureReason(failed) || failed,
      });

      const notifyFailure = async (): Promise<void> => {
        if (notifyOnFailure && record.sourceSidecar !== true) {
          createNotification(
            String(downloadDelta.id),
            {
              type: "basic",
              title: getMessage("notificationFailureTitle", [filename]),
              iconUrl: ERROR_ICON_URL,
              message: downloadFailureReason(failed) || getMessage("genericUnknownError"),
            },
            notifyDuration,
          );
        }

        if (
          record.sourceSidecar !== true &&
          promptOnFailure &&
          record.url &&
          record.allowOriginalUrlFallback !== false
        ) {
          const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
            url: record.url,
            saveAs: true,
          };
          Object.assign(
            downloadOptions,
            await resolveFirefoxDownloadContext({
              incognito: isPrivateDownloadRecord(record),
            }),
          );
          try {
            await webExtensionApi.downloads.download(downloadOptions);
          } catch (error) {
            addDownloadLog(record, "failure Save As download failed", String(error));
          }
        }

        if (backgroundRuntime.debug && !isPrivateDownloadRecord(record)) {
          /* eslint-disable no-console */
          console.log(
            "notification: created failure",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id,
          );
          /* eslint-enable no-console */
        }
      };

      // Automatic fallback chain: network/server failures get one retry
      // through the background fetch before the user sees a failure
      const errorName = downloadFailureReason(failed) || "";
      const canRetry = isRetryableDownloadFailure(failed);

      if (canRetry) {
        const retried = await downloadPorts.retry(downloadDelta.id);
        if (retried) {
          addDownloadLog(record, "retrying failed download via fetch", {
            id: downloadDelta.id,
          });
          await mergeTrackedDownload(downloadDelta.id, { adopted: false });
        } else {
          // Retryable failures always have a concrete browser error name.
          await recordHistoryStatus(errorName);
          await notifyFailure();
        }
      } else {
        await recordHistoryStatus(errorName || "failed");
        await notifyFailure();
      }
    } else if (
      notifyOnSuccess &&
      record.sourceSidecar !== true &&
      isFromSelf &&
      downloadDelta &&
      downloadDelta.state &&
      downloadDelta.state.current === "complete" &&
      downloadDelta.state.previous === "in_progress"
    ) {
      addDownloadLog(record, "download complete", { id: downloadDelta.id, filename });
      const res = await webExtensionApi.downloads.search({ id: downloadDelta.id });
      const completedItem = res[0];
      const mime = completedItem?.mime;
      const successfulLabel = getMessage("notificationSuccessTitle");
      const title = buildSuccessNotificationTitle(successfulLabel, completedItem?.fileSize, mime);

      const successDetails: SaveInNotificationOptions = {
        type: "basic",
        title,
        iconUrl: SUCCESS_ICON_URL,
        message: filename,
      };
      // Undo button: Chrome-only (Firefox rejects `buttons`), and suppressed
      // for private records to match the exclusion of private activity from
      // history — undo marks a History entry, which private saves never have.
      if (WEB_EXTENSION_CAPABILITIES.notificationButtons && !isPrivateDownloadRecord(record)) {
        Object.assign(successDetails, {
          buttons: [{ title: getMessage("notificationUndoSave") || "Undo save" }],
        });
      }
      createNotification(String(downloadDelta.id), successDetails, notifyDuration);

      if (backgroundRuntime.debug && !isPrivateDownloadRecord(record)) {
        /* eslint-disable no-console */
        console.log(
          "notification: created success",
          String(downloadDelta.id),
          notifyDuration,
          downloadDelta.id,
        );
        /* eslint-enable no-console */
      }
    }

    const isComplete = downloadDelta.state && downloadDelta.state.current === "complete";
    if (failed || isComplete) {
      if (record.offscreenRequestId) {
        await OffscreenClient.release(record.offscreenRequestId).catch((error) =>
          addDownloadLog(record, "offscreen blob release failed", String(error)),
        );
      }
      // Clear adoption but keep the record: recordHistoryStatus (above) and any
      // in-flight retry still read its historyEntryId; the cap evicts it later
      await mergeTrackedDownload(downloadDelta.id, {
        adopted: false,
        pendingSourceSidecar: undefined,
      });
    }
  }
};
