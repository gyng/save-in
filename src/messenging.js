/* eslint-disable no-case-declarations */

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case MESSAGE_TYPES.OPTIONS:
      sendResponse({
        type: MESSAGE_TYPES.OPTIONS,
        body: options
      });
      break;
    case MESSAGE_TYPES.DOWNLOAD:
      const { url, info } = request.body;
      const path = replaceSpecialDirs(lastUsedPath || "", url, info);
      const last = window.lastDownload || {};

      downloadInto({
        path,
        url,
        downloadInfo: info,
        addonOptions: options,
        suggestedFilename: null,
        context: DOWNLOAD_TYPES.CLICK,
        menuIndex: last.menuIndex || "",
        comment: last.comment || ""
      });

      sendResponse({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK }
      });
      break;
    default:
      break; // noop
  }
});
