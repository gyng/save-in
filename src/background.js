/* eslint-disable no-restricted-globals */
/* eslint-env worker */

// Chrome MV3 service worker entry point (manifest.json background.service_worker).
// Firefox ignores this file and loads the same scripts as an event page via
// background.scripts — keep the two lists in sync
// (scripts/check-background-scripts.js fails the lint on drift).

// The background scripts predate service workers and use `window` as their
// shared global namespace. Service workers have no `window`, so alias it to
// the worker global scope.
self.window = self;

importScripts(
  "browser-shim.js",
  "vendor/content-disposition.js",
  "chrome-detector.js",
  "constants.js",
  "util.js",
  "session-state.js",
  "log.js",
  "history.js",
  "counter.js",
  "notification.js",
  "path.js",
  "download.js",
  "router.js",
  "shortcut.js",
  "messaging.js",
  "headers.js",
  "variable.js",
  "menu-build.js",
  "menu-click.js",
  "menu-tabs.js",
  "option.js",
  "index.js",
);
