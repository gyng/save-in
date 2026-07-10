// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

const downloadsList = {}; // global
let requestedDownloadFlag = 0;

// storage.session no-op wrapper: persists MV3 service worker state across
// restarts; storage.session is unavailable in older Firefox
const SessionState = {
  available: () =>
    typeof browser !== "undefined" && browser.storage && browser.storage.session != null,
  get: (key) =>
    SessionState.available()
      ? browser.storage.session.get(key).catch(() => ({}))
      : Promise.resolve({}),
  set: (obj) =>
    SessionState.available() ? browser.storage.session.set(obj).catch(() => {}) : Promise.resolve(),
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

const Notification = {
  trackDownload: (downloadId) =>
    SessionState.get("siTrackedDownloads").then((res) => {
      const tracked = res.siTrackedDownloads || [];
      if (!tracked.includes(downloadId)) {
        return SessionState.set({
          siTrackedDownloads: tracked.concat(downloadId),
        });
      }
      return null;
    }),

  untrackDownload: (downloadId) =>
    SessionState.get("siTrackedDownloads").then((res) => {
      const tracked = res.siTrackedDownloads || [];
      if (tracked.includes(downloadId)) {
        return SessionState.set({
          siTrackedDownloads: tracked.filter((id) => id !== downloadId),
        });
      }
      return null;
    }),

  currentDownloadChangeListener: null,
  currentDownloadCreatedListener: null,
  currentNotificationClickListener: null,

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
  // woke them. Notification options are read from the shared `options`
  // global at event time, after awaiting init.
  onDownloadCreated: async (item) => {
    if (typeof window !== "undefined" && window.ready) {
      await window.ready.catch(() => {});
    }

    // Counter, not boolean: two concurrent requested downloads must both be
    // picked up here
    const pending = Number(requestedDownloadFlag) || 0;
    if (pending > 0) {
      requestedDownloadFlag = pending - 1;
      downloadsList[item.id] = item;
      Notification.trackDownload(item.id);
      return;
    }

    // The in-memory counter is lost if the MV3 service worker restarted
    // between requesting the download and this event
    SessionState.get("siPendingDownload").then((res) => {
      if (res.siPendingDownload) {
        downloadsList[item.id] = item;
        SessionState.set({ siPendingDownload: false });
        Notification.trackDownload(item.id);
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

      const failed = Notification.isDownloadFailure(
        downloadDelta,
        CURRENT_BROWSER === BROWSERS.CHROME,
      );

      const isFromSelf = typeof downloadsList[downloadDelta.id] !== "undefined";
      const isUserCancelled =
        downloadDelta.error && downloadDelta.error.current === "USER_CANCELED";

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
        Notification.untrackDownload(downloadDelta.id);
      }
    }
  },
};

// MV3: register at load so a worker woken BY a download event still handles
// it (guards exist only for the partial test mocks)
if (browser.downloads && browser.downloads.onCreated && browser.downloads.onChanged) {
  browser.downloads.onCreated.addListener(Notification.onDownloadCreated);
  browser.downloads.onChanged.addListener(Notification.onDownloadChanged);
}
if (browser.notifications && browser.notifications.onClicked) {
  browser.notifications.onClicked.addListener(Notification.onNotificationClicked);
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Notification;
}
