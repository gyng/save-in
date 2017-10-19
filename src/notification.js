// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const ICON_URL = "icons/ic_archive_black_128px.png";

const downloadsList = {}; // global

const addNotifications = options => {
  const notifyOnSuccess = options && options.notifyOnSuccess;
  const notifyOnFailure = options && options.notifyOnFailure;
  const notifyDuration = options && options.notifyDuration;

  browser.downloads.onCreated.addListener(item => {
    downloadsList[item.id] = item;
  });

  browser.notifications.onClicked.addListener(notId => {
    // notification ID should be set to download ID on download creation
    browser.downloads.show(Number(notId));
  });

  browser.downloads.onChanged.addListener(downloadDelta => {
    const item = downloadsList[downloadDelta.id];

    // CHROME
    // Chrome does not have the filename in the initial DownloadItem,
    // so extract it from the DownloadDelta
    if (chrome) {
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

    // CHROME
    // Chrome's DownloadDelta contains different information from Firefox's
    const failed = chrome
      ? downloadDelta.error
      : !downloadDelta ||
        !downloadDelta.state ||
        downloadDelta.state.current === "interrupted";

    if (notifyOnFailure && failed) {
      browser.notifications.create(String(downloadDelta.id), {
        type: "basic",
        title: "Failed to save",
        iconUrl: ICON_URL,
        message: filename
      });

      window.setTimeout(() => {
        browser.notifications.clear(String(downloadDelta.id));
      }, notifyDuration);
    } else if (
      notifyOnSuccess &&
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
    addNotifications
  };
}
