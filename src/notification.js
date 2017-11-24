// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";
const ERROR_ICON_URL = "icons/ic_error_outline_red_96px.png";

const downloadsList = {}; // global
let requestedDownloadFlag = false;

const isDownloadFailure = (downloadDelta, isChrome) => {
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
};

const addNotifications = options => {
  const notifyOnSuccess = options && options.notifyOnSuccess;
  const notifyOnFailure = options && options.notifyOnFailure;
  const notifyDuration = options && options.notifyDuration;

  browser.downloads.onCreated.addListener(item => {
    if (requestedDownloadFlag) {
      downloadsList[item.id] = item;
      requestedDownloadFlag = false;
    }
  });

  browser.notifications.onClicked.addListener(notId => {
    // notification ID should be set to download ID on download creation
    browser.downloads.show(Number(notId));
  });

  browser.downloads.onChanged.addListener(downloadDelta => {
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

    const failed = isDownloadFailure(downloadDelta, browser === chrome);

    const isFromSelf = typeof downloadsList[downloadDelta.id] !== "undefined";

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

    if (notifyOnFailure && isFromSelf && failed) {
      browser.notifications.create(String(downloadDelta.id), {
        type: "basic",
        title: `Failed to save ${filename}`,
        iconUrl: ERROR_ICON_URL,
        message: failed.current || "Unknown error"
      });

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
      browser.notifications.create(String(downloadDelta.id), {
        type: "basic",
        title: "Saved",
        iconUrl: ICON_URL,
        message: filename
      });

      window.setTimeout(() => {
        browser.notifications.clear(String(downloadDelta.id));
      }, notifyDuration);
    }
  });
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    addNotifications,
    isDownloadFailure
  };
}
