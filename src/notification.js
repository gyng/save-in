// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/notifications

const downloadsList = {}; // global

const addNotifications = options => {
  const notifyOnSuccess = options && options.notifyOnSuccess;
  const notifyOnFailure = options && options.notifyOnFailure;

  browser.downloads.onCreated.addListener(item => {
    downloadsList[item.id] = item;
  });

  browser.notifications.onClicked.addListener(notId => {
    // notification ID should be set to download ID on download creation
    browser.downloads.show(Number(notId));
  });

  browser.downloads.onChanged.addListener(downloadDelta => {
    const item = downloadsList[downloadDelta.id];
    const slashIdx = item.filename && item.filename.lastIndexOf("/");
    const filename = item.filename && item.filename.substring(slashIdx + 1);

    if (
      notifyOnFailure &&
      (!downloadDelta ||
        !downloadDelta.state ||
        downloadDelta.state.current === "interrupted")
    ) {
      browser.notifications.create(String(downloadDelta.id), {
        type: "basic",
        title: "Failed to save",
        message: `${filename}`
      });
    } else if (
      notifyOnSuccess &&
      downloadDelta.state.current === "complete" &&
      downloadDelta.state.previous === "in_progress"
    ) {
      browser.notifications.create(String(downloadDelta.id), {
        type: "basic",
        title: "Saved",
        message: `${filename}`
      });
    }
  });
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    addNotifications
  };
}
