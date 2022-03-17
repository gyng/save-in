// @ts-check

// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

/** @type {Record<string | number, browser.downloads.DownloadItem>} */
const downloadsList = {}; // global

/** @type {boolean | number} */
let requestedDownloadFlag = 0;

const CustomNotification = {
  /** @type {null | (() => any)} */
  currentDownloadChangeListener: null,
  /** @type {null | (() => any)} */
  currentDownloadCreatedListener: null,
  /** @type {null | (() => any)} */
  currentNotificationClickListener: null,

  createExtensionNotification: (
    /** @type {string} */ title,
    /** @type {string} */ message,
    /** @type {boolean | undefined} */ error
  ) => {
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

  isDownloadFailure: (
    /** @type {browser.downloads._OnChangedDownloadDelta} */ downloadDelta,
    /** @type {boolean} */ isChrome
  ) => {
    // CHROME
    // Chrome's DownloadDelta contains different information from Firefox's
    /** @type {boolean | undefined | browser.downloads.StringDelta} */
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

  addNotifications: (
    /** @type {{ notifyOnSuccess: boolean; notifyOnFailure: boolean; notifyDuration: number; promptOnFailure: boolean; }} */ options
  ) => {
    const notifyOnSuccess = options && options.notifyOnSuccess;
    const notifyOnFailure = options && options.notifyOnFailure;
    const notifyDuration = options && options.notifyDuration;
    const promptOnFailure = options && options.promptOnFailure;

    if (!notifyDuration && window.SI_DEBUG) {
      console.log("Bad notify duration", options); // eslint-disable-line
    }

    const onDownloadCreatedListener = (
      /** @type {browser.downloads.DownloadItem} */ item
    ) => {
      if (requestedDownloadFlag) {
        downloadsList[item.id] = item;
        requestedDownloadFlag = false;
      }
    };

    if (
      CustomNotification.currentDownloadCreatedListener &&
      browser.downloads.onCreated.hasListener(
        CustomNotification.currentDownloadCreatedListener
      )
    ) {
      browser.downloads.onCreated.removeListener(
        CustomNotification.currentDownloadCreatedListener
      );
    }
    browser.downloads.onCreated.addListener(onDownloadCreatedListener);
    CustomNotification.currentDownloadCreatedListener =
      onDownloadCreatedListener;

    const onNotificationClickedListener = (
      /** @type {string | number} */ notId
    ) => {
      if (String(notId).startsWith("save-in-not-")) {
        return;
      }

      // notification ID should be set to download ID on download creation
      browser.downloads.show(Number(notId));
    };

    if (
      CustomNotification.currentNotificationClickListener &&
      browser.notifications.onClicked.hasListener(
        CustomNotification.currentNotificationClickListener
      )
    ) {
      browser.notifications.onClicked.removeListener(
        CustomNotification.currentNotificationClickListener
      );
    }
    CustomNotification.currentNotificationClickListener =
      onNotificationClickedListener;
    browser.notifications.onClicked.addListener(onNotificationClickedListener);

    const onDownloadChangeListener = (
      /** @type {browser.downloads._OnChangedDownloadDelta} */ downloadDelta
    ) => {
      const item = downloadsList[downloadDelta.id];

      if (!item) {
        return;
      }

      // CHROME
      // Chrome does not have the filename in the initial DownloadItem,
      // so extract it from the DownloadDelta
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
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
      // @ts-expect-error
      const filename = fullFilename.substring(slashIdx + 1);

      const failed = CustomNotification.isDownloadFailure(
        downloadDelta,
        CURRENT_BROWSER === BROWSERS.CHROME
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
              // @ts-ignore
              failed.current || browser.i18n.getMessage("genericUnknownError"),
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
      CustomNotification.currentDownloadChangeListener &&
      browser.downloads.onChanged.hasListener(
        CustomNotification.currentDownloadChangeListener
      )
    ) {
      browser.downloads.onChanged.removeListener(
        CustomNotification.currentDownloadChangeListener
      );
    }
    browser.downloads.onChanged.addListener(onDownloadChangeListener);
    CustomNotification.currentDownloadChangeListener = onDownloadChangeListener;
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = CustomNotification;
}
