// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

const downloadsList = {}; // global
let requestedDownloadFlag = 0;

const Notification = {
  currentDownloadChangeListener: null,
  currentDownloadCreatedListener: null,
  currentNotificationClickListener: null,

  createExtensionNotification: (title, message, error) => {
    const id = `save-in-not-${String(Math.floor(Math.random() * 100000))}`;
    browser.notifications.create(id, {
      type: "basic",
      title: title || "Save In",
      iconUrl: error ? ERROR_ICON_URL : ICON_URL,
      message: message || "Unknown error"
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

  addNotifications: options => {
    const notifyOnSuccess = options && options.notifyOnSuccess;
    const notifyOnFailure = options && options.notifyOnFailure;
    const notifyDuration = options && options.notifyDuration;
    const promptOnFailure = options && options.promptOnFailure;

    if (!notifyDuration && window.SI_DEBUG) {
      console.log("Bad notify duration", options); // eslint-disable-line
    }

    const onDownloadCreatedListener = item => {
      if (requestedDownloadFlag) {
        downloadsList[item.id] = item;
        requestedDownloadFlag = false;
      }
    };

    if (
      Notification.currentDownloadCreatedListener &&
      browser.downloads.onCreated.hasListener(
        Notification.currentDownloadCreatedListener
      )
    ) {
      browser.downloads.onCreated.removeListener(
        Notification.currentDownloadCreatedListener
      );
    }
    browser.downloads.onCreated.addListener(onDownloadCreatedListener);
    Notification.currentDownloadCreatedListener = onDownloadCreatedListener;

    const onNotificationClickedListener = notId => {
      if (String(notId).startsWith("save-in-not-")) {
        return;
      }

      // notification ID should be set to download ID on download creation
      browser.downloads.show(Number(notId));
    };

    if (
      Notification.currentNotificationClickListener &&
      browser.notifications.onClicked.hasListener(
        Notification.currentNotificationClickListener
      )
    ) {
      browser.notifications.onClicked.removeListener(
        Notification.currentNotificationClickListener
      );
    }
    Notification.currentNotificationClickListener = onNotificationClickedListener;
    browser.notifications.onClicked.addListener(onNotificationClickedListener);

    const onDownloadChangeListener = downloadDelta => {
      const item = downloadsList[downloadDelta.id];

      if (!item) {
        return;
      }

      // CHROME
      // Chrome does not have the filename in the initial DownloadItem,
      // so extract it from the DownloadDelta
      if (browser === chrome) {
        if (
          downloadDelta &&
          downloadDelta.filename &&
          downloadDelta.filename.current
        ) {
          downloadsList[downloadDelta.id].filename =
            downloadDelta.filename.current;
        }
      }

      const fullFilename = item && item.filename;
      const slashIdx = fullFilename && fullFilename.lastIndexOf("/");
      const filename = fullFilename.substring(slashIdx + 1);

      const failed = Notification.isDownloadFailure(
        downloadDelta,
        browser === chrome
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
          downloadDelta
        );
        /* eslint-enable no-console */
      }

      if (isFromSelf && failed && !isUserCancelled) {
        if (notifyOnFailure) {
          browser.notifications.create(String(downloadDelta.id), {
            type: "basic",
            title: `Failed to save ${filename}`,
            iconUrl: ERROR_ICON_URL,
            message: failed.current || "Unknown error"
          });
        }

        if (promptOnFailure) {
          browser.downloads.download({
            url: downloadsList[downloadDelta.id].url,
            saveAs: true
          });
        }

        if (window.SI_DEBUG) {
          /* eslint-disable no-console */
          console.log(
            "notification: created failure",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id
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
        browser.downloads.search({ id: downloadDelta.id }).then(res => {
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

          const title =
            res.length > 0 ? `Saved — ${filesize} — ${mime}` : "Saved";

          browser.notifications.create(String(downloadDelta.id), {
            type: "basic",
            title,
            iconUrl: ICON_URL,
            message: filename
          });
        });

        if (window.SI_DEBUG) {
          /* eslint-disable no-console */
          console.log(
            "notification: created success",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id
          );
          /* eslint-enable no-console */
        }

        window.setTimeout(() => {
          browser.notifications.clear(String(downloadDelta.id));
        }, notifyDuration);
      }
    };

    if (
      Notification.currentDownloadChangeListener &&
      browser.downloads.onChanged.hasListener(
        Notification.currentDownloadChangeListener
      )
    ) {
      browser.downloads.onChanged.removeListener(
        Notification.currentDownloadChangeListener
      );
    }
    browser.downloads.onChanged.addListener(onDownloadChangeListener);
    Notification.currentDownloadChangeListener = onDownloadChangeListener;
  }
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Notification;
}
