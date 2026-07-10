// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

const downloadsList = {}; // global

// How many downloads this extension has requested that downloads.onCreated
// has not yet seen. A counter (not a boolean) so concurrent downloads are
// all picked up. Incremented via Notifier.expectDownload().
let expectedDownloads = 0;

// storage.session no-op wrapper: persists MV3 service worker state across
// restarts; storage.session is unavailable in older Firefox
const SessionState = {
  available: () =>
    typeof browser !== "undefined" && browser.storage && browser.storage.session != null,
  /** @returns {Promise<Record<string, any>>} */
  get: (key) =>
    SessionState.available()
      ? browser.storage.session.get(key).catch(() => ({}))
      : Promise.resolve({}),
  set: (obj) =>
    SessionState.available() ? browser.storage.session.set(obj).catch(() => {}) : Promise.resolve(),

  // Serialised read-modify-write for one session key. Concurrent downloads
  // mutating the same key (the pending counter or the per-URL filename map)
  // would otherwise lose updates.
  queue: Promise.resolve(),
  update: (key, fn) => {
    SessionState.queue = SessionState.queue
      .then(() => SessionState.get(key))
      .then((res) => SessionState.set({ [key]: fn(res[key]) }))
      .catch(() => {});
    return SessionState.queue;
  },
};

// Restore tracked downloads on startup: MV3 service worker globals do not
// survive termination, so in-flight downloads would otherwise lose their
// completion/failure notifications
SessionState.get("siTrackedDownloads").then((res) => {
  const tracked = res.siTrackedDownloads || [];
  if (tracked.length === 0) {
    return;
  }

  Promise.all(
    tracked.map((id) =>
      browser.downloads
        .search({ id })
        .then((items) => {
          const item = items && items[0];
          if (item && item.state !== "complete") {
            downloadsList[id] = item;
            return id;
          }
          return null;
        })
        .catch(() => null),
    ),
  ).then((ids) => {
    const validIds = ids.filter((id) => id != null);
    if (validIds.length !== tracked.length) {
      SessionState.set({ siTrackedDownloads: validIds });
    }
  });
});

const Notifier = {
  // Serialise siTrackedDownloads mutations: concurrent read-modify-writes
  // (two downloads created in the same tick) would drop entries
  trackQueue: Promise.resolve(),

  mutateTracked: (fn) => {
    Notifier.trackQueue = Notifier.trackQueue
      .then(() => SessionState.get("siTrackedDownloads"))
      .then((res) => {
        const next = fn(res.siTrackedDownloads || []);
        return next ? SessionState.set({ siTrackedDownloads: next }) : null;
      })
      .catch(() => {});
    return Notifier.trackQueue;
  },

  trackDownload: (downloadId) =>
    Notifier.mutateTracked((tracked) =>
      tracked.includes(downloadId) ? null : tracked.concat(downloadId),
    ),

  untrackDownload: (downloadId) =>
    Notifier.mutateTracked((tracked) =>
      tracked.includes(downloadId) ? tracked.filter((id) => id !== downloadId) : null,
    ),

  createExtensionNotification: (title, message, error) => {
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

  // Returns Firefox/Chrome error deltas ({ current }) or a boolean
  /** @returns {any} */
  isDownloadFailure: (downloadDelta, isChrome) => {
    // CHROME
    // Chrome's DownloadDelta contains different information from Firefox's
    let failed = false;

    if (isChrome) {
      failed = downloadDelta.error;
    } else {
      failed =
        downloadDelta.error ||
        (downloadDelta.state && downloadDelta.state.current === "interrupted");
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

    if (expectedDownloads > 0) {
      expectedDownloads -= 1;
      downloadsList[item.id] = item;
      Notifier.trackDownload(item.id);
      return;
    }

    // The in-memory counter is lost if the MV3 service worker restarted
    // between requesting the download and this event. siPendingDownloads is a
    // COUNTER (not a boolean) so several downloads created after one restart
    // are all recovered — a boolean dropped every one past the first.
    SessionState.get("siPendingDownloads").then((res) => {
      if (res.siPendingDownloads > 0) {
        downloadsList[item.id] = item;
        SessionState.update("siPendingDownloads", (n) => Math.max(0, (n || 0) - 1));
        Notifier.trackDownload(item.id);
      }
    });
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
      const item = downloadsList[downloadDelta.id];

      if (!item) {
        return;
      }

      // CHROME
      // Chrome does not have the filename in the initial DownloadItem,
      // so extract it from the DownloadDelta
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        if (downloadDelta && downloadDelta.filename && downloadDelta.filename.current) {
          downloadsList[downloadDelta.id].filename = downloadDelta.filename.current;
        }
      }

      // Filename can be missing on entries restored after a service worker
      // restart until a filename delta arrives
      const fullFilename = (item && item.filename) || "";
      const slashIdx = fullFilename.lastIndexOf("/");
      const filename = fullFilename.substring(slashIdx + 1);

      const failed = Notifier.isDownloadFailure(downloadDelta, CURRENT_BROWSER === BROWSERS.CHROME);

      const isFromSelf = typeof downloadsList[downloadDelta.id] !== "undefined";
      const isUserCancelled =
        downloadDelta.error && downloadDelta.error.current === "USER_CANCELED";

      // Record the final outcome against the history entry (independent of
      // whether success/failure notifications are enabled)
      const recordHistoryStatus = (status) => {
        if (
          typeof Download === "undefined" ||
          !Download.startedDownloads ||
          typeof SaveHistory === "undefined"
        ) {
          return;
        }
        const record = Download.startedDownloads.get(downloadDelta.id);
        if (!record || !record.historyEntryId) {
          return;
        }
        // On completion, record the final file size in the history entry too
        if (status === "complete") {
          browser.downloads
            .search({ id: downloadDelta.id })
            .then((items) => {
              const item = items && items[0];
              const size = item ? (item.fileSize > 0 ? item.fileSize : item.totalBytes) : 0;
              SaveHistory.setStatus(
                record.historyEntryId,
                status,
                downloadDelta.id,
                size > 0 ? size : null,
              );
            })
            .catch(() => SaveHistory.setStatus(record.historyEntryId, status, downloadDelta.id));
          return;
        }
        SaveHistory.setStatus(record.historyEntryId, status, downloadDelta.id);
      };

      if (
        isFromSelf &&
        downloadDelta.state &&
        downloadDelta.state.current === "complete" &&
        !isUserCancelled
      ) {
        recordHistoryStatus("complete");
      }

      if (window.SI_DEBUG) {
        /* eslint-disable no-console */
        console.log(
          "notification",
          failed,
          isFromSelf,
          downloadsList,
          downloadDelta,
          notifyOnSuccess,
        );
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
              url: downloadsList[downloadDelta.id].url,
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
        const canRetry =
          /^(NETWORK_|SERVER_)/.test(errorName) &&
          typeof Download !== "undefined" &&
          typeof Download.retryViaFetch === "function";

        if (canRetry) {
          Download.retryViaFetch(downloadDelta.id).then((retried) => {
            if (retried) {
              if (typeof Log !== "undefined") {
                Log.add("retrying failed download via fetch", { id: downloadDelta.id });
              }
              // The retry is tracked as its own download and carries the
              // history entry id, so its outcome updates this same entry
              delete downloadsList[downloadDelta.id];
              Notifier.untrackDownload(downloadDelta.id);
            } else {
              recordHistoryStatus(errorName || "failed");
              notifyFailure();
            }
          });
        } else {
          recordHistoryStatus(errorName || "failed");
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
        browser.downloads.search({ id: downloadDelta.id }).then((res) => {
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
        delete downloadsList[downloadDelta.id];
        Notifier.untrackDownload(downloadDelta.id);
      }
    }
  },
};

// MV3: register at load so a worker woken BY a download event still handles
// it (guards exist only for the partial test mocks)
if (browser.downloads && browser.downloads.onCreated && browser.downloads.onChanged) {
  browser.downloads.onCreated.addListener(Notifier.onDownloadCreated);
  browser.downloads.onChanged.addListener(Notifier.onDownloadChanged);
}
if (browser.notifications && browser.notifications.onClicked) {
  browser.notifications.onClicked.addListener(Notifier.onNotificationClicked);
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Notifier;
}
