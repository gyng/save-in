// @ts-check

const CustomHeaders = {
  refererListener: (
    /** @type {browser.webRequest._OnBeforeSendHeadersDetails} */ details
  ) => {
    // TODO: option to ignore or rewrite referer, check if needed
    // @ts-ignore
    const existingReferer = details.requestHeaders.find(
      (h) => h.name === "Referer"
    );
    if (existingReferer) {
      return {};
    }

    // @ts-ignore
    if (!globalChromeState || !globalChromeState.info) {
      return {};
    }

    // @ts-ignore
    const { pageUrl } = globalChromeState.info;
    if (!pageUrl) {
      return {};
    }

    const referer = {
      name: "Referer",
      value: pageUrl,
    };
    // @ts-ignore
    details.requestHeaders.push(referer);

    return { requestHeaders: details.requestHeaders };
  },

  addRequestListener: () => {
    browser.webRequest.onBeforeSendHeaders.removeListener(
      CustomHeaders.refererListener
    );

    if (options.setRefererHeader) {
      const filterList = options.setRefererHeaderFilter || "";

      const urls = filterList
        .split("\n")
        .map((/** @type {string} */ s) => s.trim());

      /** @type {browser.webRequest.OnBeforeSendHeadersOptions[]} */
      const listenerOptions = ["blocking", "requestHeaders"];

      // Chrome needs `extraHeaders` to set Referer
      // https://developer.chrome.com/extensions/webRequest
      // Firefox doesn't permit unknown options and dies, so we need this explicit check
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        // @ts-expect-error Chrome-only value for listenerOptions
        listenerOptions.push("extraHeaders");
      }

      browser.webRequest.onBeforeSendHeaders.addListener(
        CustomHeaders.refererListener,
        { urls },
        listenerOptions
      );
    }
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = CustomHeaders;
}
