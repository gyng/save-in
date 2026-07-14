import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

import { downloadsState, sessionWriteState } from "./state.ts";
import { getDownload, mergeDownload } from "./download-state.ts";
import { isPrivateDownloadRecord } from "./download-state.ts";
import type { DownloadRecord, DownloadRecordUpdate } from "./download-state.ts";
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
  getDownloadFailure,
  isRetryableDownloadFailure,
} from "./notification-model.ts";
import { runEventTask } from "../shared/event-task.ts";
import { resolveFirefoxDownloadContext } from "./auth-context.ts";
import { OffscreenClient } from "../platform/offscreen-client.ts";
export { recoverNotificationState } from "./notification-recovery.ts";

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
const INFO_ICON_URL = "icons/ic_archive_black_128px.png";
const SUCCESS_ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_archive_black_128px.png";
const EXTENSION_NOTIFICATION_DEBOUNCE_MS = 250;

export const EXTENSION_NOTIFICATION_STREAMS = Object.freeze({
  DOWNLOAD_FAILURE: "download-failure",
  EXTERNAL_DOWNLOAD_REJECTION: "external-download-rejection",
  LINK_PREFERRED: "link-preferred",
  PREFER_LINKS_PATTERN_ERROR: "prefer-links-pattern-error",
  ROUTE_MATCH: "route-match",
  ROUTE_MISS: "route-miss",
});

type ExtensionNotificationStream =
  | (typeof EXTENSION_NOTIFICATION_STREAMS)[keyof typeof EXTENSION_NOTIFICATION_STREAMS]
  | "general";
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

const historyPort = downloadPorts.history;
const logPort = downloadPorts.log;
const backgroundRuntime = downloadPorts.runtime;
const notificationClearTimers = new Map<string, TimerHandle>();
const extensionNotificationDebounceTimers = new Map<string, TimerHandle>();

const addDownloadLog = (record: DownloadRecord, message: string, data?: unknown): unknown =>
  isPrivateDownloadRecord(record)
    ? logPort.add(message, data, { privateContext: true })
    : logPort.add(message, data);

const createNotification = (
  id: string,
  details: SaveInNotificationOptions,
  duration = options.notifyDuration,
) => {
  const previousClearTimer = notificationClearTimers.get(id);
  if (previousClearTimer !== undefined) {
    globalThis.clearTimeout(previousClearTimer);
    notificationClearTimers.delete(id);
  }

  const created = Promise.resolve(webExtensionApi.notifications.create(id, details)).then(
    () => undefined,
    (error) => {
      logPort.add("notification create failed", String(error));
    },
  );
  if (duration > 0) {
    const clearTimer = globalThis.setTimeout(() => {
      notificationClearTimers.delete(id);
      void Promise.resolve(webExtensionApi.notifications.clear(id)).catch((error) =>
        logPort.add("notification clear failed", String(error)),
      );
    }, duration);
    notificationClearTimers.set(id, clearTimer);
  }
  return created;
};

const queueExtensionNotification = (
  id: string,
  details: SaveInNotificationOptions,
  duration = options.notifyDuration,
) => {
  const previousClearTimer = notificationClearTimers.get(id);
  if (previousClearTimer !== undefined) {
    globalThis.clearTimeout(previousClearTimer);
    notificationClearTimers.delete(id);
  }

  const previousDebounceTimer = extensionNotificationDebounceTimers.get(id);
  if (previousDebounceTimer !== undefined) globalThis.clearTimeout(previousDebounceTimer);

  const debounceTimer = globalThis.setTimeout(() => {
    extensionNotificationDebounceTimers.delete(id);
    createNotification(id, details, duration);
  }, EXTENSION_NOTIFICATION_DEBOUNCE_MS);
  extensionNotificationDebounceTimers.set(id, debounceTimer);
};

// Membership ("this download is ours, watch it for a completion notification")
// lives on the DownloadState record as `adopted`, so there is no second
// per-download structure to keep in sync — download.js's started record and the
// notifier's watch list are the same record. `currentFilename` caches the
// browser's actual path (Chrome only reveals it via onChanged deltas) for the
// notification body, distinct from the record's intended `filename`.

// Downloads handed to downloads.download that onCreated has not yet seen.
// URL correlation prevents a rejected or unrelated request from consuming a
// different attempt; the persisted counter remains the worker-restart fallback.
type ExpectedDownload = {
  url?: string | undefined;
  record?: Partial<DownloadRecord> | undefined;
};
const expectedDownloads: ExpectedDownload[] = [];

// Recovery of adopted and pending records is owned by notification-recovery.ts.
const mergeTrackedDownload = (downloadId: number, partial: DownloadRecordUpdate) =>
  mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, downloadId, partial);

const getTrackedDownload = (downloadId: number) =>
  getDownload(downloadsState, extensionSessionStorage, downloadId);

export const Notifier = {
  createExtensionNotification: (
    title: string | null,
    message?: string | null,
    error?: unknown,
    stream: ExtensionNotificationStream = "general",
  ) => {
    // WebExtension notifications use their caller-supplied ID as the stable
    // replacement key (the equivalent of a Service Worker notification tag).
    // Keep streams distinct while coalescing bursts before they reach the OS.
    const id = `save-in-not-${stream}`;
    queueExtensionNotification(id, {
      type: "basic",
      title: title || getMessage("extensionName"),
      iconUrl: error ? ERROR_ICON_URL : INFO_ICON_URL,
      message: message || getMessage("genericUnknownError"),
    });
  },

  reportExternalDownloadRejection: (senderId: string): Promise<void> =>
    createNotification(
      `save-in-not-${EXTENSION_NOTIFICATION_STREAMS.EXTERNAL_DOWNLOAD_REJECTION}`,
      {
        type: "basic",
        title: getMessage("notificationExternalDownloadBlockedTitle"),
        iconUrl: ERROR_ICON_URL,
        message: getMessage("notificationExternalDownloadBlockedMessage", [senderId]),
      },
    ),

  // Single user-facing path for a TERMINAL download failure that happens before
  // a download is even created (the pipeline throwing, or downloads.download
  // rejecting after the fetch fallback is exhausted) — cases onDownloadChanged
  // never sees. Gated on notifyOnFailure so it stays consistent with the
  // post-creation failure notification.
  reportFailure: (name: string, message?: string) => {
    if (!(options && options.notifyOnFailure)) {
      return;
    }
    Notifier.createExtensionNotification(
      getMessage("notificationFailureTitle", [name || ""]),
      message || getMessage("genericUnknownError"),
      true,
      EXTENSION_NOTIFICATION_STREAMS.DOWNLOAD_FAILURE,
    );
  },

  // Returns Firefox/Chrome error deltas ({ current }) or a boolean.
  isDownloadFailure: getDownloadFailure,

  // Handlers are registered once at load (bottom of this file): MV3 workers
  // must register listeners synchronously or they miss the very event that
  // woke them. Notifier options are read from the shared `options`
  // global at event time, after awaiting init.
  // Call before webExtensionApi.downloads.download() so onDownloadCreated knows
  // the next created download is ours
  expectDownload: (url?: string, record?: DownloadRecordUpdate): ExpectedDownload => {
    const expected = { url, record };
    expectedDownloads.push(expected);
    return expected;
  },

  cancelExpectedDownload: (expected: ExpectedDownload): void => {
    const index = expectedDownloads.indexOf(expected);
    if (index !== -1) expectedDownloads.splice(index, 1);
  },

  onDownloadCreated: async (item: HostDownloadItem) => {
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
    const expectedIndex = expectedDownloads.findIndex(
      (expected) => expected.url == null || expected.url === item.url || expected.url === finalUrl,
    );
    // Private ordinary downloads are neither tracked nor experimentally
    // replaced. Save In-owned private downloads are handled by the in-memory
    // expected record below, without writing their metadata to storage.session.
    if (item.incognito && !isPrivateDownloadRecord(expectedDownloads[expectedIndex]?.record || {}))
      return;
    if (expectedIndex !== -1) {
      const [expected] = expectedDownloads.splice(expectedIndex, 1);
      // expectedIndex came from this same array, so splice always returns one entry.
      const matched = expected!;
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
        const expected = Notifier.expectDownload(browserDownloadUrl, {
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
          setTimeout(() => Notifier.cancelExpectedDownload(expected), 10000);
          void historyPort.setDownloadId(historyEntryId, replacementId);
        } catch (error) {
          Notifier.cancelExpectedDownload(expected);
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
  },

  onNotificationClicked: (notId: string) => {
    if (notId === `save-in-not-${EXTENSION_NOTIFICATION_STREAMS.EXTERNAL_DOWNLOAD_REJECTION}`) {
      return webExtensionApi.runtime.openOptionsPage();
    }
    if (String(notId).startsWith("save-in-not-")) {
      return;
    }

    // notification ID should be set to download ID on download creation
    return webExtensionApi.downloads.show(Number(notId));
  },

  onDownloadChanged: async (downloadDelta: HostDownloadDelta) => {
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
        const failed = Notifier.isDownloadFailure(
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

      const failed = Notifier.isDownloadFailure(
        downloadDelta,
        WEB_EXTENSION_CAPABILITIES.downloadDeltaFilename,
      );

      const isFromSelf = record.adopted === true;
      const isUserCancelled =
        downloadDelta.error && downloadDelta.error.current === "USER_CANCELED";

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

      if (
        isFromSelf &&
        downloadDelta.state &&
        downloadDelta.state.current === "complete" &&
        !isUserCancelled
      ) {
        await recordHistoryStatus("complete");
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
          if (notifyOnFailure) {
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

          if (promptOnFailure && record.allowOriginalUrlFallback !== false) {
            const downloadOptions: Parameters<typeof webExtensionApi.downloads.download>[0] = {
              url: record.url!,
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

        createNotification(
          String(downloadDelta.id),
          {
            type: "basic",
            title,
            iconUrl: SUCCESS_ICON_URL,
            message: filename,
          },
          notifyDuration,
        );

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
        await mergeTrackedDownload(downloadDelta.id, { adopted: false });
      }
    }
  },
};

// MV3: entry.background calls this synchronously at startup so a worker woken BY
// a download event still has the handler attached (guards exist only for the
// partial test mocks).
export const registerNotifier = () => {
  if (
    webExtensionApi.downloads &&
    webExtensionApi.downloads.onCreated &&
    webExtensionApi.downloads.onChanged
  ) {
    webExtensionApi.downloads.onCreated.addListener((item) =>
      runEventTask(
        () => Notifier.onDownloadCreated(item),
        (error) => logPort.add("download created event failed", String(error)),
      ),
    );
    webExtensionApi.downloads.onChanged.addListener((delta) =>
      runEventTask(
        () => Notifier.onDownloadChanged(delta),
        (error) => logPort.add("download changed event failed", String(error)),
      ),
    );
  }
  if (webExtensionApi.notifications && webExtensionApi.notifications.onClicked) {
    webExtensionApi.notifications.onClicked.addListener((notificationId) =>
      runEventTask(
        () => Notifier.onNotificationClicked(notificationId),
        (error) => logPort.add("notification click event failed", String(error)),
      ),
    );
  }
};
