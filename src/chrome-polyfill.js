if (typeof browser === 'undefined') {
  if (chrome) {
    browser = chrome; // eslint-disable-line
    const cbGet = browser.storage.local.get; // eslint-disable-line
    browser.storage.local.get = keys => new Promise(resolve => cbGet(keys, resolve));
  }
}
