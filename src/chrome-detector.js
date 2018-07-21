const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX"
};

if (typeof browser === "undefined") {
  if (chrome) {
    CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
  }
} else {
  if (browser.runtime.getBrowserInfo) {
    browser.runtime.getBrowserInfo().then(res => {
      if (res.name === "Firefox") {
        CURRENT_BROWSER = BROWSERS.FIREFOX; // eslint-disable-line
      }
    });
  }

  // If we don't have browser.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but browser.runtime.getBrowserInfo is not well supported
  CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
}
