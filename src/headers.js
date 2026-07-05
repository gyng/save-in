const Headers = {
  addRequestListener: async () => {
    // Clear old dynamic rules
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
    });

    if (options.setRefererHeader) {
      const filterList = options.setRefererHeaderFilter ?? "";
      const urls = filterList
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s);

      if (!urls.length) return;

      const pageUrl = self.globalChromeState?.info?.pageUrl;
      if (!pageUrl) return;

      // Add a dynamic DNR rule
      await browser.declarativeNetRequest.updateDynamicRules({
        addRules: [
          {
            id: 1,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                {
                  header: "Referer",
                  operation: "set",
                  value: pageUrl,
                },
              ],
            },
            condition: {
              urlFilter: urls.length === 1 ? urls[0] : undefined, // Simplify if possible
              resourceTypes: [
                "main_frame",
                "sub_frame",
                "xmlhttprequest",
                "other",
              ],
            },
          },
        ],
      });
    }
  },
};

if (typeof module !== "undefined") {
  module.exports = Headers;
}
