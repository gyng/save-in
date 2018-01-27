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
      const last = window.lastDownloadState || {
        path: new Paths.Path("."),
        scratch: {},
        info: {}
      };

      const opts = {
        currentTab, // Global
        now: new Date(),
        pageUrl: info.pageUrl,
        selectionText: info.selectionText,
        sourceUrl: info.srcUrl,
        url,
        context: DOWNLOAD_TYPES.CLICK
      };

      const clickState = {
        path: last.path || new Paths.Path("."),
        scratch: last.scratch,
        route: last.route,
        info: Object.assign({}, last.info, opts, info)
      };

      Downloads.renameAndDownload(clickState);

      sendResponse({
        type: MESSAGE_TYPES.DOWNLOAD,
        body: { status: MESSAGE_TYPES.OK }
      });
      break;
    default:
      break; // noop
  }
});
