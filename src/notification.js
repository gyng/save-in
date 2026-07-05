// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

const downloadsList = {}; // global
let requestedDownloadFlag = 0;

// Restore tracked downloads on SW restart (MV3 — globals don't survive termination)
(async () => {
  try {
    const { siTrackedDownloads = [] } = await browser.storage.session.get(
      "siTrackedDownloads"
    );

    // Prune stale IDs (downloads that completed while SW was terminated)
    const results = await Promise.all(
      siTrackedDownloads.map(async (id) => {
        const [item] = await browser.downloads.search({ id }).catch(() => []);
        if (
          item &&
          (item.state === "in_progress" || item.state === "interrupted")
        ) {
          downloadsList[id] = { id };
          return id;
        }
        return null;
      })
    );
    const validIds = results.filter(Boolean);
    if (validIds.length !== siTrackedDownloads.length) {
      await browser.storage.session
        .set({ siTrackedDownloads: validIds })
        .catch(() => {});
    }
  } catch (e) {
    // session storage unavailable or first run
  }
})();

const Notification = {
  currentDownloadChangeListener: null,
  currentDownloadCreatedListener: null,
  currentNotificationClickListener: null,

  createExtensionNotification: (title, message, error) => {
    const id = `save-in-not-${String(Math.floor(Math.random() * 100000))}`;
    browser.notifications.create(id, {
      type: "basic",
      title: title ?? browser.i18n.getMessage("extensionName"),
      iconUrl: error ? ERROR_ICON_URL : ICON_URL,
      message: message ?? browser.i18n.getMessage("genericUnknownError"),
    });

    if (options && options.notifyDuration) {
      self.setTimeout(() => {
        browser.notifications.clear(id);
      }, options.notifyDuration);
    }
  },

  isDownloadFailure: (downloadDelta) => downloadDelta.error,

  addNotifications: (options) => {
    const notifyOnSuccess = options?.notifyOnSuccess;
    const notifyOnFailure = options?.notifyOnFailure;
    const notifyDuration = options?.notifyDuration;
    const promptOnFailure = options?.promptOnFailure;

    if (!notifyDuration && self.SI_DEBUG) {
      console.log("Bad notify duration", options); // eslint-disable-line
    }

    const onDownloadCreatedListener = async (item) => {
      const { siPendingDownload } = await browser.storage.session
        .get("siPendingDownload")
        .catch(() => ({}));
      if (requestedDownloadFlag || siPendingDownload) {
        downloadsList[item.id] = item;
        requestedDownloadFlag = false;
        // Persist to session storage so it survives SW termination
        await browser.storage.session
          .set({ siPendingDownload: false })
          .catch(() => {});
        const { siTrackedDownloads = [] } = await browser.storage.session
          .get("siTrackedDownloads")
          .catch(() => ({}));
        if (!siTrackedDownloads.includes(item.id)) {
          await browser.storage.session
            .set({
              siTrackedDownloads: [...siTrackedDownloads, item.id],
            })
            .catch(() => {});
        }
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

    const onNotificationClickedListener = (notId) => {
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
    Notification.currentNotificationClickListener =
      onNotificationClickedListener;
    browser.notifications.onClicked.addListener(onNotificationClickedListener);

    const onDownloadChangeListener = (downloadDelta) => {
      const item = downloadsList[downloadDelta.id];

      if (!item) {
        return;
      }

      // CHROME
      // Chrome does not have the filename in the initial DownloadItem,
      // so extract it from the DownloadDelta
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        if (downloadDelta?.filename?.current) {
          downloadsList[downloadDelta.id].filename =
            downloadDelta.filename.current;
        }
      }

      const fullFilename = item?.filename;
      const slashIdx = fullFilename?.lastIndexOf("/");
      const filename = fullFilename.substring(slashIdx + 1);

      const failed = Notification.isDownloadFailure(downloadDelta);

      const isFromSelf = typeof downloadsList[downloadDelta.id] !== "undefined";
      const isUserCancelled = downloadDelta.error?.current === "USER_CANCELED";

      if (self.SI_DEBUG) {
        /* eslint-disable no-console */
        console.log(
          "notification",
          failed,
          isFromSelf,
          downloadsList,
          downloadDelta,
          notifyOnSuccess
        );
        /* eslint-enable no-console */
      }

      if (isFromSelf && failed && !isUserCancelled) {
        if (notifyOnFailure) {
          browser.notifications.create(String(downloadDelta.id), {
            type: "basic",
            title: browser.i18n.getMessage("notificationFailureTitle", [
              filename,
            ]),
            iconUrl: ERROR_ICON_URL,
            message:
              failed.current ?? browser.i18n.getMessage("genericUnknownError"),
          });
        }

        if (promptOnFailure) {
          browser.downloads.download({
            url: downloadsList[downloadDelta.id].url,
            saveAs: true,
          });
        }

        if (self.SI_DEBUG) {
          /* eslint-disable no-console */
          console.log(
            "notification: created failure",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id
          );
          /* eslint-enable no-console */
        }

        // Clean up session storage tracking (fire-and-forget)
        if (downloadDelta?.id) {
          browser.storage.session
            .get("siTrackedDownloads")
            .then(({ siTrackedDownloads = [] }) => {
              browser.storage.session
                .set({
                  siTrackedDownloads: siTrackedDownloads.filter(
                    (id) => id !== downloadDelta.id
                  ),
                })
                .catch(() => {});
            })
            .catch(() => {});
        }

        if (downloadDelta?.id) {
          self.setTimeout(() => {
            browser.notifications.clear(String(downloadDelta.id));
            delete downloadsList[downloadDelta.id];
          }, notifyDuration);
        }
      } else if (
        notifyOnSuccess &&
        isFromSelf &&
        downloadDelta?.state?.current === "complete" &&
        downloadDelta?.state?.previous === "in_progress"
      ) {
        browser.downloads.search({ id: downloadDelta.id }).then((res) => {
          let filesize = "";
          const mime = res[0]?.mime;

          if (res[0]?.fileSize) {
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

          const successfulLabel = browser.i18n.getMessage(
            "notificationSuccessTitle"
          );
          const title =
            res.length > 0
              ? `${successfulLabel} · ${filesize} · ${mime}`
              : successfulLabel;

          browser.notifications.create(String(downloadDelta.id), {
            type: "basic",
            title,
            iconUrl: ICON_URL,
            message: filename,
          });
        });

        if (self.SI_DEBUG) {
          /* eslint-disable no-console */
          console.log(
            "notification: created success",
            String(downloadDelta.id),
            notifyDuration,
            downloadDelta.id
          );
          /* eslint-enable no-console */
        }

        // Clean up session storage tracking (fire-and-forget)
        browser.storage.session
          .get("siTrackedDownloads")
          .then(({ siTrackedDownloads = [] }) => {
            browser.storage.session
              .set({
                siTrackedDownloads: siTrackedDownloads.filter(
                  (id) => id !== downloadDelta.id
                ),
              })
              .catch(() => {});
          })
          .catch(() => {});

        self.setTimeout(() => {
          browser.notifications.clear(String(downloadDelta.id));
          delete downloadsList[downloadDelta.id];
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
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Notification;
}
