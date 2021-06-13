const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX",
};

let BROWSER_FEATURES; // eslint-disable-line
let CURRENT_BROWSER = BROWSERS.CHROME;
let CURRENT_BROWSER_VERSION;

const setFeatures = (browser, version) => {
  // defaults
  const features = {
    multitab: false,
    accessKeys: true,
  };

  if (browser === BROWSERS.FIREFOX && version >= 63) {
    features.multitab = true;
  }

  if (browser === BROWSERS.FIREFOX && version < 63) {
    features.accessKeys = false;
  }

  return features;
};

if (typeof browser === "undefined") {
  if (chrome) {
    CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
  }
} else if (browser.runtime.getBrowserInfo) {
  browser.runtime
    .getBrowserInfo()
    .then((res) => {
      if (res.name === "Firefox") {
        CURRENT_BROWSER = BROWSERS.FIREFOX; // eslint-disable-line
        CURRENT_BROWSER_VERSION = parseFloat(res.version);
      } else {
        CURRENT_BROWSER = BROWSERS.CHROME;
      }

      BROWSER_FEATURES = setFeatures(CURRENT_BROWSER, CURRENT_BROWSER_VERSION);
    })
    .catch((e) => {
      console.log("Failed to get browser version", e); // eslint-disable-line
      CURRENT_BROWSER = BROWSERS.CHROME;
      BROWSER_FEATURES = setFeatures(CURRENT_BROWSER, CURRENT_BROWSER_VERSION);
    });
} else {
  // If we don't have browser.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but browser.runtime.getBrowserInfo is not well supported
  CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
  BROWSER_FEATURES = setFeatures(CURRENT_BROWSER, CURRENT_BROWSER_VERSION);  // eslint-disable-line
}
