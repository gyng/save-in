/* eslint-disable no-case-declarations */

const Messaging = {
  // Fires off and does not expect a return value
  emit: {
    downloaded: (state) => {
      // In MV3 sendMessage rejects when no receiver (options page) is open;
      // that is expected, so swallow it rather than leak an unhandled rejection
      browser.runtime
        .sendMessage({
          type: MESSAGE_TYPES.DOWNLOADED,
          body: { state },
        })
        .catch(() => {});
    },
  },

  // Returns a Promise
  send: {
    fetchViaContent: (state) =>
      new Promise((resolve, reject) => {
        browser.tabs
          .query({
            currentWindow: true,
            active: true,
          })
          .then((tabs) => {
            // With no active tab there is no content script to fetch through:
            // reject so the caller's fallback runs instead of hanging forever
            if (!tabs || !tabs[0]) {
              reject(new Error("No active tab for fetchViaContent"));
              return;
            }
            browser.tabs
              .sendMessage(tabs[0].id, {
                type: MESSAGE_TYPES.FETCH_VIA_CONTENT,
                body: { state },
              })
              .then(resolve)
              .catch((err) => {
                if (window.SI_DEBUG) {
                  console.log(err); // eslint-disable-line
                }
                reject(err);
              });
          })
          .catch(reject);
      }),
  },

  /**
   * This is an unofficial, unsupported method for use with external extensions.
   * Please use this at your own risk and without any warranty. PRs are welcome.
   *
   * See: https://github.com/gyng/save-in/wiki/Use-with-Foxy-Gestures
   *
   * In Foxy Gestures:
   *
   * const source = data.element.mediaInfo && data.element.mediaInfo.source;
   *
   * if (source) {
   *   const payload = {
   *     type: "DOWNLOAD",
   *       body: {
   *         url: source,
   *         // You can use `comment` for targeting in routing rules
   *         info: { pageUrl: `${window.location}`, srcUrl: source, comment: "foo" }
   *       }
   *   };
   *
   *   // ID obtained from manifest.json
   *   browser.runtime.sendMessage("{72d92df5-2aa0-4b06-b807-aa21767545cd}", payload);
   * }
   */
  handleDownloadMessage: (request, sender, sendResponse) => {
    const { url, comment } = request.body;
    // The external onMessageExternal API may omit info
    const info = request.body.info || {};
    const last = window.lastDownloadState || {
      path: new Path.Path("."),
      scratch: {},
      info: {},
    };

    const opts = {
      // Prefer the tab the message came from over the tracked global (#172)
      currentTab: (sender && sender.tab) || currentTab,
      now: new Date(),
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      sourceUrl: info.srcUrl,
      url,
      context: DOWNLOAD_TYPES.CLICK,
    };

    // Useful for passing in from external extensions
    if (comment) {
      opts.comment = comment;
    }

    // Reuse the last download's directory and routing metadata
    // (comment/menuindex rules stay usable), but never its route, filenames,
    // or scratch: those describe a different URL, and inheriting them names
    // this download after the previous one. renameAndDownload re-evaluates
    // the routing rules and filenames for this URL.
    const clickState = {
      path: last.path || new Path.Path("."),
      scratch: {},
      info: Object.assign(
        {
          menuIndex: last.info && last.info.menuIndex,
          comment: last.info && last.info.comment,
        },
        opts,
        info,
      ),
    };

    Notification.expectDownload();
    Download.renameAndDownload(clickState);

    sendResponse({
      type: MESSAGE_TYPES.DOWNLOAD,
      body: { status: MESSAGE_TYPES.OK },
    });
  },
};

browser.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case MESSAGE_TYPES.DOWNLOAD:
      Messaging.handleDownloadMessage(request, sender, sendResponse);
      break;
    default:
      // noop
      break;
  }
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case MESSAGE_TYPES.WAKE_WARM:
      // Sent by content scripts on combo keydown purely to wake the MV3
      // service worker before a click-to-save message arrives
      sendResponse({ type: MESSAGE_TYPES.OK });
      break;
    case MESSAGE_TYPES.OPTIONS_LOADED:
      // Sent by the options page after saving: reload options and menus.
      // MV3 has no getBackgroundPage, so this goes over messaging instead.
      window.reset();
      sendResponse({ type: MESSAGE_TYPES.OK });
      break;
    case MESSAGE_TYPES.OPTIONS:
      sendResponse({
        type: MESSAGE_TYPES.OPTIONS,
        body: options,
      });
      break;
    case MESSAGE_TYPES.OPTIONS_SCHEMA:
      sendResponse({
        type: MESSAGE_TYPES.OPTIONS_SCHEMA,
        body: {
          keys: OptionsManagement.OPTION_KEYS,
          types: OptionsManagement.OPTION_TYPES,
        },
      });
      break;
    case MESSAGE_TYPES.GET_KEYWORDS:
      sendResponse({
        type: MESSAGE_TYPES.KEYWORD_LIST,
        body: {
          matchers: Object.keys(Router.matcherFunctions),
          variables: Object.keys(Variable.transformers),
        },
      });
      break;
    case MESSAGE_TYPES.CHECK_ROUTES:
      const lastState =
        (request.body && request.body.state) ||
        (window.lastDownloadState != null && window.lastDownloadState);

      const interpolatedVariables = lastState
        ? Object.keys(Variable.transformers).reduce(
            (acc, val) =>
              Object.assign(acc, {
                [val]: Variable.applyVariables(new Path.Path(val), lastState.info).finalize(),
              }),
            {},
          )
        : null;

      sendResponse({
        type: MESSAGE_TYPES.CHECK_ROUTES_RESPONSE,
        body: {
          optionErrors: window.optionErrors,
          routeInfo: OptionsManagement.checkRoutes(lastState),
          lastDownload: window.lastDownloadState,
          interpolatedVariables,
        },
      });
      break;
    case MESSAGE_TYPES.DOWNLOAD:
      Messaging.handleDownloadMessage(request, sender, sendResponse);
      break;
    default:
      break; // noop
  }
});

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Messaging;
}
