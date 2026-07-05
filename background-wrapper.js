try {
  importScripts(
    "src/vendor/browser-polyfill.js",
    "src/vendor/content-disposition.js",
    "src/constants.js",
    "src/history.js",
    "src/notification.js",
    "src/path.js",
    "src/download.js",
    "src/router.js",
    "src/shortcut.js",
    "src/messaging.js",
    "src/headers.js",
    "src/variable.js",
    "src/menu.js",
    "src/option.js",
    "src/index.js"
  );
} catch (e) {
  console.error("Failed to load scripts into Service Worker", e);
}