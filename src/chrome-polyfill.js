if (typeof browser === "undefined") {
  if (chrome) {
    browser = chrome; // eslint-disable-line
    const storageCbGet = browser.storage.local.get;
    browser.storage.local.get = keys =>
      new Promise(resolve => storageCbGet(keys, resolve));

    const tabCbGet = browser.tabs.get;
    browser.tabs.get = tabId =>
      new Promise(resolve => tabCbGet(tabId, resolve));
  }
}
