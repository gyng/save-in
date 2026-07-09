// First-party replacement for the Mozilla webextension-polyfill: Firefox
// provides the native promise-based `browser` global, and Chrome >= 123
// (minimum_chrome_version) returns promises from every extension API this
// codebase awaits when no callback is passed (contextMenus was the last
// holdout, promise-capable since 123).
if (typeof globalThis.browser === "undefined") {
  globalThis.browser = chrome;
}
