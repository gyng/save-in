const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX"
};

if (typeof browser === "undefined" || browser !== chrome) {
  if (chrome) {
    CURRENT_BROWSER = BROWSERS.CHROME; // eslint-disable-line
  } else {
    CURRENT_BROWSER = BROWSERS.FIREFOX; // eslint-disable-line
  }
}
