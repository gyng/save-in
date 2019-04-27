const Headers = {
  refererListener: details => {
    // TODO: option to ignore or rewrite referer, check if needed
    const existingReferer = details.requestHeaders.find(
      h => h.name === "Referer"
    );
    if (existingReferer) {
      return {};
    }

    if (!globalChromeState || !globalChromeState.info) {
      return {};
    }

    const { pageUrl } = globalChromeState.info;
    if (!pageUrl) {
      return {};
    }

    const referer = {
      name: "Referer",
      value: pageUrl
    };
    details.requestHeaders.push(referer);

    return { requestHeaders: details.requestHeaders };
  },

  addRequestListener: () => {
    browser.webRequest.onBeforeSendHeaders.removeListener(
      Headers.refererListener
    );

    if (options.setRefererHeader) {
      const filterList = options.setRefererHeaderFilter || "";

      const urls = filterList.split("\n").map(s => s.trim());

      const listenerOptions = ["blocking", "requestHeaders"];

      // Chrome needs `extraHeaders` to set Referer
      // https://developer.chrome.com/extensions/webRequest
      // Firefox doesn't permit unknown options and dies, so we need this explicit check
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        listenerOptions.push("extraHeaders");
      }

      browser.webRequest.onBeforeSendHeaders.addListener(
        Headers.refererListener,
        { urls },
        listenerOptions
      );
    }
  }
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Headers;
}
