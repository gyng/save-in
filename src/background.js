/* eslint-disable no-restricted-globals */
/* eslint-env worker */

// Chrome MV3 service worker entry point (manifest.json background.service_worker).
// Firefox ignores this file and loads the same scripts as an event page via
// background.scripts — keep the two lists in sync.

// The background scripts predate service workers and use `window` as their
// shared global namespace. Service workers have no `window`, so alias it to
// the worker global scope.
self.window = self;

importScripts(
  "vendor/browser-polyfill.js",
  "vendor/content-disposition.js",
  "chrome-detector.js",
  "constants.js",
  "log.js",
  "history.js",
  "notification.js",
  "path.js",
  "download.js",
  "router.js",
  "shortcut.js",
  "messaging.js",
  "headers.js",
  "variable.js",
  "menu.js",
  "option.js",
  "index.js",
);
