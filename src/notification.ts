// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

import { DownloadState, SessionState } from "./application-state.ts";
import { options } from "./options-data.ts";
import { CURRENT_BROWSER, BROWSERS } from "./chrome-detector.ts";
import { DownloadRetry } from "./download-retry.ts";
import { SaveHistory } from "./history.ts";
import { Log } from "./log.ts";

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

// Membership ("this download is ours, watch it for a completion notification")
// lives on the DownloadState record as `adopted`, so there is no second
// per-download structure to keep in sync — download.js's started record and the
// notifier's watch list are the same record. `currentFilename` caches the
// browser's actual path (Chrome only reveals it via onChanged deltas) for the
// notification body, distinct from the record's intended `filename`.

// How many downloads this extension has requested that downloads.onCreated
// has not yet seen. A counter (not a boolean) so concurrent downloads are
// all picked up. Incremented via Notifier.expectDownload().
let expectedDownloads = 0;

// A leftover siPendingDownloads (persisted before downloads.download) lets a
// download that was in flight when the worker died recover its notification.
// After this grace window a stale count is cleared so it can't adopt an
// unrelated download — see the startup reconciliation below.
const PENDING_RECOVERY_GRACE_MS = 10000;

// SessionState (the storage.session wrapper) lives in session-state.js so
// Notifier, Download and Log share one implementation.

// Reconcile adopted downloads on startup: MV3 service worker globals do not
// survive termination, so the records are rehydrated from storage.session
// (DownloadState.hydrate). Any adopted download that already completed or
// vanished while the worker was dead will never fire another onChanged, so its
// adoption is cleared — otherwise it would leak. A still-live download keeps its
// adoption and recovers its completion/failure notification when it finishes.
const reconcileAdoptedDownloads = async () => {
  await DownloadState.hydrate();
  const adoptedIds = [];
  DownloadState.records.forEach((record, id) => {
    if (record && record.adopted) {
      adoptedIds.push(id);
    }
  });

  await Promise.all(
    adoptedIds.map(async (id) => {
      try {
        const items = await browser.downloads.search({ id });
        const item = items && items[0];
        if (!item || item.state === "complete") {
          await DownloadState.merge(id, { adopted: false });
        }
      } catch {
        await DownloadState.merge(id, { adopted: false });
      }
    }),
  );
};

// Reconcile the pending-download counter on startup: honor a leftover count
// briefly (a download in flight when the worker died fires onCreated within
// seconds), then subtract whatever of it remains so a stale leak — a requested
// download that never actually created — can't later adopt an unrelated
// download as ours.
const reconcilePendingDownloads = async () => {
  const res = await SessionState.get("siPendingDownloads");
  const staleAtStartup = res.siPendingDownloads || 0;
  if (staleAtStartup > 0) {
    setTimeout(() => {
      SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) - staleAtStartup));
    }, PENDING_RECOVERY_GRACE_MS);
  }
};

export const notifierReady = Promise.all([
  reconcileAdoptedDownloads(),
  reconcilePendingDownloads(),
]);

export const Notifier = {
  createExtensionNotification: (title, message?, error?) => {
    const id = `save-in-not-${String(Math.floor(Math.random() * 100000))}`;
    browser.notifications.create(id, {
      type: "basic",
      title: title || browser.i18n.getMessage("extensionName"),
      iconUrl: error ? ERROR_ICON_URL : ICON_URL,
      message: message || browser.i18n.getMessage("genericUnknownError"),
    });

    if (options && options.notifyDuration) {
      window.setTimeout(() => {
        browser.notifications.clear(id);
      }, options.notifyDuration);
    }
  },

  // Single user-facing path for a TERMINAL download failure that happens before
  // a download is even created (the pipeline throwing, or downloads.download
  // rejecting after the fetch fallback is exhausted) — cases onDownloadChanged
  // never sees. Gated on notifyOnFailure so it stays consistent with the
  // post-creation failure notification.
  reportFailure: (name, message) => {
    if (!(options && options.notifyOnFailure)) {
      return;
    }
    Notifier.createExtensionNotification(
      browser.i18n.getMessage("notificationFailureTitle", [name || ""]),
      message || browser.i18n.getMessage("genericUnknownError"),
      true,
    );
  },

  // Returns Firefox/Chrome error deltas ({ current }) or a boolean
  /** @returns {any} */
  isDownloadFailure: (downloadDelta, isChrome): any => {
    // CHROME
    // Chrome's DownloadDelta contains different information from Firefox's
    let failed = false;

    if (isChrome) {
      failed = downloadDelta.error;
    } else {
      // Firefox reports pauses and resumable network stalls as
      // state:"interrupted" too — neither is a real failure, so treating them
      // as one produced a spurious "failed" toast (§8.4, #28). Only a terminal
      // (not paused, not resumable) interruption counts.
      const paused = downloadDelta.paused && downloadDelta.paused.current === true;
      const resumable = downloadDelta.canResume && downloadDelta.canResume.current === true;
      const interrupted = downloadDelta.state && downloadDelta.state.current === "interrupted";
      failed = !paused && !resumable && (downloadDelta.error || interrupted);
    }

    return failed;
  },

  // Handlers are registered once at load (bottom of this file): MV3 workers
  // must register listeners synchronously or they miss the very event that
  // woke them. Notifier options are read from the shared `options`
  // global at event time, after awaiting init.
  // Call before browser.downloads.download() so onDownloadCreated knows
  // the next created download is ours
  expectDownload: () => {
    expectedDownloads += 1;
  },

  onDownloadCreated: async (item) => {
    if (typeof window !== "undefined" && window.ready) {
      await window.ready.catch(() => {});
    }

    // Never adopt a download another extension initiated — a leaked pending
    // count must not track it as ours and fire a spurious notification. Only a
    // KNOWN-different byExtensionId is rejected: our own downloads may not have
    // byExtensionId populated yet at onCreated (Chrome), so an absent id is left
    // to the counters below.
    if (item.byExtensionId && browser.runtime && item.byExtensionId !== browser.runtime.id) {
      return;
    }

    if (expectedDownloads > 0) {
      expectedDownloads -= 1;
      await DownloadState.merge(item.id, {
        adopted: true,
        currentFilename: item.filename,
        url: item.url,
      });
      return;
    }

    // The in-memory counter is lost if the MV3 service worker restarted
    // between requesting the download and this event. siPendingDownloads is a
    // COUNTER (not a boolean) so several downloads created after one restart
    // are all recovered — a boolean dropped every one past the first.
    const res = await SessionState.get("siPendingDownloads");
    if (res.siPendingDownloads > 0) {
      await DownloadState.merge(item.id, {
        adopted: true,
        currentFilename: item.filename,
        url: item.url,
      });
      await SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) - 1));
    }
  },

  onNotificationClicked: (notId) => {
    if (String(notId).startsWith("save-in-not-")) {
      return;
    }

    // notification ID should be set to download ID on download creation
    browser.downloads.show(Number(notId));
  },

  onDownloadChanged: async (downloadDelta) => {
    if (typeof window !== "undefined" && window.ready) {
      await window.ready.catch(() => {});
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
      const record = await DownloadState.get(downloadDelta.id);

      if (!record || !record.adopted) {
        return;
      }

      // CHROME
      // Chrome does not have the filename in the initial DownloadItem,
      // so extract it from the DownloadDelta
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        if (downloadDelta && downloadDelta.filename && downloadDelta.filename.current) {
          record.currentFilename = downloadDelta.filename.current;
          await DownloadState.merge(downloadDelta.id, {
            currentFilename: downloadDelta.filename.current,
          });
        }
      }

      // Filename can be missing on entries restored after a service worker
      // restart until a filename delta arrives; fall back to the intended path
      const fullFilename = record.currentFilename || record.filename || "";
      const slashIdx = fullFilename.lastIndexOf("/");
      const filename = fullFilename.substring(slashIdx + 1);

      const failed = Notifier.isDownloadFailure(downloadDelta, CURRENT_BROWSER === BROWSERS.CHROME);

      const isFromSelf = record.adopted === true;
      const isUserCancelled =
        downloadDelta.error && downloadDelta.error.current === "USER_CANCELED";

      // Record the final outcome against the history entry (independent of
      // whether success/failure notifications are enabled)
      const recordHistoryStatus = async (status) => {
        if (typeof SaveHistory === "undefined") {
          return;
        }
        // Read from memory, or the persisted copy if the worker restarted since
        // the download started (so a mid-restart download still gets its status)
        const started = await DownloadState.get(downloadDelta.id);
        if (!started || !started.historyEntryId) return;
        if (status === "complete") {
          try {
            const items = await browser.downloads.search({ id: downloadDelta.id });
            const item = items && items[0];
            const size = item ? (item.fileSize > 0 ? item.fileSize : item.totalBytes) : 0;
            await SaveHistory.setStatus(
              started.historyEntryId,
              status,
              downloadDelta.id,
              size > 0 ? size : null,
            );
          } catch {
            await SaveHistory.setStatus(started.historyEntryId, status, downloadDelta.id);
          }
          return;
        }
        await SaveHistory.setStatus(started.historyEntryId, status, downloadDelta.id);
      };

      if (
        isFromSelf &&
        downloadDelta.state &&
        downloadDelta.state.current === "complete" &&
        !isUserCancelled
      ) {
        await recordHistoryStatus("complete");
      }

      if (window.SI_DEBUG) {
        /* eslint-disable no-console */
        console.log("notification", failed, isFromSelf, record, downloadDelta, notifyOnSuccess);
        /* eslint-enable no-console */
      }

      if (isFromSelf && failed && !isUserCancelled) {
        if (typeof Log !== "undefined") {
          Log.add("download failed", {
            id: downloadDelta.id,
            error: failed.current || failed,
          });
        }

        const notifyFailure = () => {
          if (notifyOnFailure) {
            browser.notifications.create(String(downloadDelta.id), {
              type: "basic",
              title: browser.i18n.getMessage("notificationFailureTitle", [filename]),
              iconUrl: ERROR_ICON_URL,
              message: failed.current || browser.i18n.getMessage("genericUnknownError"),
            });
          }

          if (promptOnFailure) {
            browser.downloads.download({
              url: record.url,
              saveAs: true,
            });
          }

          if (window.SI_DEBUG) {
            /* eslint-disable no-console */
            console.log(
              "notification: created failure",
              String(downloadDelta.id),
              notifyDuration,
              downloadDelta.id,
            );
            /* eslint-enable no-console */
          }

          if (downloadDelta && downloadDelta.id) {
            window.setTimeout(() => {
              browser.notifications.clear(String(downloadDelta.id));
            }, notifyDuration);
          }
        };

        // Automatic fallback chain: network/server failures get one retry
        // through the background fetch before the user sees a failure
        const errorName = (failed && failed.current) || "";
        const canRetry = /^(NETWORK_|SERVER_)/.test(errorName);

        if (canRetry) {
          const retried = await DownloadRetry.retry(downloadDelta.id);
          if (retried) {
            if (typeof Log !== "undefined") {
              Log.add("retrying failed download via fetch", { id: downloadDelta.id });
            }
            await DownloadState.merge(downloadDelta.id, { adopted: false });
          } else {
            await recordHistoryStatus(errorName || "failed");
            notifyFailure();
          }
        } else {
          await recordHistoryStatus(errorName || "failed");
          notifyFailure();
        }
      } else if (
        notifyOnSuccess &&
        isFromSelf &&
        downloadDelta &&
        downloadDelta.state &&
        downloadDelta.state.current === "complete" &&
        downloadDelta.state.previous === "in_progress"
      ) {
        if (typeof Log !== "undefined") {
          Log.add("download complete", { id: downloadDelta.id, filename });
        }
        const res = await browser.downloads.search({ id: downloadDelta.id });
        let filesize = "";
        const mime = res.length > 0 && res[0].mime;

        if (res.length > 0 && res[0].fileSize) {
          const bytes = res[0].fileSize;
          if (bytes >= 1000 * 1000) {
            const mb = (res[0].fileSize / 1000 / 1000).toFixed(1);
            filesize = `${mb} MB`;
          } else if (bytes >= 1000) {
            const kb = (res[0].fileSize / 1000).toFixed(1);
            filesize = `${kb} KB`;
          } else {
            filesize = `${bytes} B`;
          }
        }

        const successfulLabel = browser.i18n.getMessage("notificationSuccessTitle");
        const title =
          res.length > 0 ? `${successfulLabel} · ${filesize} · ${mime}` : successfulLabel;

        browser.notifications.create(String(downloadDelta.id), {
          type: "basic",
          title,
          iconUrl: ICON_URL,
          message: filename,
        });

        if (window.SI_DEBUG) {
          /* eslint-disable no-console */
          console.log(
            "notification: created success",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id,
          );
          /* eslint-enable no-console */
        }

        window.setTimeout(() => {
          browser.notifications.clear(String(downloadDelta.id));
        }, notifyDuration);
      }

      const isComplete = downloadDelta.state && downloadDelta.state.current === "complete";
      if (failed || isComplete) {
        // Clear adoption but keep the record: recordHistoryStatus (above) and any
        // in-flight retry still read its historyEntryId; the cap evicts it later
        await DownloadState.merge(downloadDelta.id, { adopted: false });
      }
    }
  },
};

// MV3: entry.background calls this synchronously at startup so a worker woken BY
// a download event still has the handler attached (guards exist only for the
// partial test mocks).
export const registerNotifier = () => {
  if (browser.downloads && browser.downloads.onCreated && browser.downloads.onChanged) {
    browser.downloads.onCreated.addListener(Notifier.onDownloadCreated);
    browser.downloads.onChanged.addListener(Notifier.onDownloadChanged);
  }
  if (browser.notifications && browser.notifications.onClicked) {
    browser.notifications.onClicked.addListener(Notifier.onNotificationClicked);
  }
};
