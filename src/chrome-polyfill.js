// Chrome somehow lazily loads and wraps func
// so function.length cannot be used to determine arity
const promisify = (func, arity) =>
  function _promisify(args) {
    if (arity === 0) {
      return new Promise(resolve => {
        func(resolve);
      });
    } else if (arity === 1) {
      return new Promise(resolve => {
        func(args, resolve);
      });
    } else {
      return new Promise(resolve => {
        func(...arguments, resolve); // eslint-disable-line
      });
    }
  };

if (typeof browser === "undefined") {
  if (chrome) {
    browser = chrome; // eslint-disable-line
    browser.storage.local.get = promisify(browser.storage.local.get, 1);
    browser.storage.local.set = promisify(browser.storage.local.set, 1);
    browser.storage.local.clear = promisify(browser.storage.local.clear, 0);
    browser.tabs.get = promisify(browser.tabs.get, 1);
    browser.tabs.query = promisify(browser.tabs.query, 1);
    browser.tabs.sendMessage = promisify(browser.tabs.sendMessage, 2);
    browser.runtime.sendMessage = promisify(browser.runtime.sendMessage, 1);
    browser.runtime.getBackgroundPage = promisify(
      browser.runtime.getBackgroundPage,
      0
    );
    browser.contextMenus.removeAll = promisify(
      browser.contextMenus.removeAll,
      0
    );
    browser.management.getSelf = promisify(browser.management.getSelf, 0);
    browser.permissions.getAll = promisify(browser.permissions.getAll, 0);
  }
}
