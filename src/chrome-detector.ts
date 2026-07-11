export const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX",
  UNKNOWN: "UNKNOWN",
};

export type BrowserFeatures = { multitab: boolean; accessKeys: boolean };

// Mutable cross-file state: reassigned only in this module (by the detection
// block below and `setCurrentBrowser`); other modules import a read-only live
// binding and read it at call time.
export let BROWSER_FEATURES: BrowserFeatures | undefined;
export let CURRENT_BROWSER = BROWSERS.UNKNOWN;
export let CURRENT_BROWSER_VERSION: number | undefined;

export const setFeatures = (currentBrowser: string): BrowserFeatures => ({
  // Multi-select tab strip menus need the Firefox-only "tab" context
  multitab: currentBrowser === BROWSERS.FIREFOX,
  accessKeys: true,
});

// The write-half of the CURRENT_BROWSER/BROWSER_FEATURES live bindings: they
// always move together (a browser and its feature set), so both detection and
// tests switch browser through here rather than reassigning the pair by hand.
export const setCurrentBrowser = (currentBrowser: string) => {
  CURRENT_BROWSER = currentBrowser; // eslint-disable-line
  BROWSER_FEATURES = setFeatures(currentBrowser);
};

if (typeof browser === "undefined") {
  if (chrome) {
    setCurrentBrowser(BROWSERS.CHROME);
  }
} else if (browser.runtime.getBrowserInfo) {
  // Only Gecko-based browsers implement getBrowserInfo: treat forks like
  // Waterfox or LibreWolf as Firefox regardless of the reported name (#186)
  setCurrentBrowser(BROWSERS.FIREFOX);

  browser.runtime
    .getBrowserInfo()
    .then((res) => {
      CURRENT_BROWSER_VERSION = parseFloat(res.version);
    })
    .catch(() => {});
} else {
  // If we don't have browser.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but browser.runtime.getBrowserInfo is not well supported
  setCurrentBrowser(BROWSERS.CHROME);
}
