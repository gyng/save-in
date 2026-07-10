const RequestHeaders = {
  refererListener: (details) => {
    // TODO: option to ignore or rewrite referer, check if needed
    const existingReferer = details.requestHeaders.find((h) => h.name === "Referer");
    if (existingReferer) {
      return {};
    }

    // Correlate by request URL so overlapping downloads each get their own
    // page's referer; the most-recent state is the fallback (e.g. redirects)
    const state =
      (typeof Download !== "undefined" &&
        Download.pendingStates &&
        Download.pendingStates.get(details.url)) ||
      globalChromeState;

    if (!state || !state.info) {
      return {};
    }

    const { pageUrl } = state.info;
    if (!pageUrl) {
      return {};
    }

    const referer = {
      name: "Referer",
      value: pageUrl,
    };
    details.requestHeaders.push(referer);

    return { requestHeaders: details.requestHeaders };
  },

  DNR_REFERER_RULE_ID: 4077,
  // Concurrent downloads needing different referers must not share one rule id
  // (the second would clobber the first). Cycle through a bounded range and
  // reuse ids (removeRuleIds before addRules), so at most COUNT rules coexist.
  DNR_REFERER_RULE_COUNT: 50,
  refererRuleOffset: 0,
  nextRefererRuleId: () => {
    const id = RequestHeaders.DNR_REFERER_RULE_ID + RequestHeaders.refererRuleOffset;
    RequestHeaders.refererRuleOffset =
      (RequestHeaders.refererRuleOffset + 1) % RequestHeaders.DNR_REFERER_RULE_COUNT;
    return id;
  },

  // Matches URLs against the newline-separated match patterns in
  // options.setRefererHeaderFilter (e.g., `*://i.pximg.net/*`), following
  // WebExtension match pattern semantics: the host part is anchored so a
  // pattern cannot match inside another URL's query string
  matchPatternToRegExp: (pattern) => {
    const escapeRegExp = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

    const parts = pattern.match(/^(\*|https?|file|ftp):\/\/([^/]*)(\/.*)$/);
    if (!parts) {
      return null;
    }

    const scheme = parts[1] === "*" ? "https?" : parts[1];

    let host;
    if (parts[2] === "*") {
      host = "[^/]+";
    } else if (parts[2].startsWith("*.")) {
      host = `([^/]+\\.)?${escapeRegExp(parts[2].slice(2))}`;
    } else {
      host = escapeRegExp(parts[2]);
    }

    const path = parts[3].split("*").map(escapeRegExp).join(".*");

    return new RegExp(`^${scheme}://${host}${path}$`);
  },

  matchesRefererFilter: (url) =>
    (options.setRefererHeaderFilter || "")
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .some((pattern) => {
        try {
          const re = RequestHeaders.matchPatternToRegExp(pattern);
          return re != null && re.test(url);
        } catch (e) {
          return false;
        }
      }),

  // True when a blocking webRequest listener is registered (Firefox);
  // Chrome MV3 exposes webRequest but rejects the "blocking" option, so
  // this is determined by attempting registration, not by presence
  usingBlockingWebRequest: false,

  // Without blocking webRequest: set the Referer header for the upcoming
  // download with a declarativeNetRequest session rule instead
  prepareReferer: (state) => {
    if (!options.setRefererHeader) {
      return Promise.resolve();
    }

    // The blocking webRequest listener already handles it
    if (RequestHeaders.usingBlockingWebRequest) {
      return Promise.resolve();
    }

    if (typeof chrome === "undefined" || !chrome.declarativeNetRequest) {
      return Promise.resolve();
    }

    const pageUrl = state && state.info && state.info.pageUrl;
    const url = state && state.info && state.info.url;

    if (!pageUrl || !url || !RequestHeaders.matchesRefererFilter(url)) {
      return Promise.resolve();
    }

    const ruleId = RequestHeaders.nextRefererRuleId();
    return chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [
          {
            id: ruleId,
            action: {
              type: "modifyHeaders",
              requestHeaders: [{ header: "Referer", operation: "set", value: pageUrl }],
            },
            condition: { urlFilter: url },
          },
        ],
      })
      .then(() => {
        if (typeof Log !== "undefined") {
          Log.add("referer session rule set", { id: ruleId, url, referer: pageUrl });
        }

        // Best-effort cleanup so the rule does not outlive the download
        setTimeout(() => {
          chrome.declarativeNetRequest
            .updateSessionRules({
              removeRuleIds: [ruleId],
            })
            .catch(() => {});
        }, 30000);
      })
      .catch(() => {});
  },

  addRequestListener: () => {
    RequestHeaders.usingBlockingWebRequest = false;

    if (!browser.webRequest || !browser.webRequest.onBeforeSendHeaders) {
      // No webRequest at all; see RequestHeaders.prepareReferer
      return;
    }

    browser.webRequest.onBeforeSendHeaders.removeListener(RequestHeaders.refererListener);

    if (options.setRefererHeader) {
      const filterList = options.setRefererHeaderFilter || "";

      // Empty lines (e.g. a trailing newline in the textarea) are invalid
      // match patterns: addListener would throw and kill init before the
      // menus are created (#222)
      const urls = filterList
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (urls.length === 0) {
        return;
      }

      // Cross-browser union: "extraHeaders" exists on Chrome only
      /** @type {any[]} */
      const listenerOptions = ["blocking", "requestHeaders"];

      // Chrome needs `extraHeaders` to set Referer
      // https://developer.chrome.com/extensions/webRequest
      // Firefox doesn't permit unknown options and dies, so we need this explicit check
      if (CURRENT_BROWSER === BROWSERS.CHROME) {
        listenerOptions.push("extraHeaders");
      }

      try {
        browser.webRequest.onBeforeSendHeaders.addListener(
          RequestHeaders.refererListener,
          { urls },
          listenerOptions,
        );
        RequestHeaders.usingBlockingWebRequest = true;
      } catch (e) {
        // Chrome MV3 rejects "blocking" (prepareReferer's DNR rules take
        // over), and an invalid user-supplied match pattern must not break
        // startup (#222)
        console.error("Blocking webRequest unavailable", urls, e); // eslint-disable-line
      }
    }
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = RequestHeaders;
}
