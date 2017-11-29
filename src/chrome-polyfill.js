// Chrome somehow lazily loads and wraps func
// so function.length cannot be used to determine arity
const promisify = (func, arity) => args => {
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
      func(...args, resolve);
    });
  }
};

if (typeof browser === "undefined") {
  if (chrome) {
    browser = chrome; // eslint-disable-line
    browser.storage.local.get = promisify(browser.storage.local.get, 1);
    browser.storage.local.clear = promisify(browser.storage.local.clear, 0);
    browser.tabs.get = promisify(browser.tabs.get, 1);
  }
}
