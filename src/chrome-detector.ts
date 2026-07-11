export const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX",
  UNKNOWN: "UNKNOWN",
};

// Mutable cross-file state: reassigned only in this module by the detection
// logic below; other modules import a read-only live binding.
export let BROWSER_FEATURES; // eslint-disable-line
export let CURRENT_BROWSER = BROWSERS.UNKNOWN;
export let CURRENT_BROWSER_VERSION;

export const setFeatures = (currentBrowser) => ({
  // Multi-select tab strip menus need the Firefox-only "tab" context
  multitab: currentBrowser === BROWSERS.FIREFOX,
  accessKeys: true,
});

if (typeof browser === "undefined") {
  if (chrome) {
    CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
    BROWSER_FEATURES = setFeatures(CURRENT_BROWSER);
  }
} else if (browser.runtime.getBrowserInfo) {
  // Only Gecko-based browsers implement getBrowserInfo: treat forks like
  // Waterfox or LibreWolf as Firefox regardless of the reported name (#186)
  CURRENT_BROWSER = BROWSERS.FIREFOX;
  BROWSER_FEATURES = setFeatures(CURRENT_BROWSER);

  browser.runtime
    .getBrowserInfo()
    .then((res) => {
      CURRENT_BROWSER_VERSION = parseFloat(res.version);
    })
    .catch(() => {});
} else {
  // If we don't have browser.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but browser.runtime.getBrowserInfo is not well supported
  CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
  BROWSER_FEATURES = setFeatures(CURRENT_BROWSER); // eslint-disable-line
}
