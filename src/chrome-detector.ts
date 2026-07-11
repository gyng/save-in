import { webExtensionApi } from "./web-extension-api.ts";

export const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX",
  UNKNOWN: "UNKNOWN",
};

export type WebExtensionCapabilities = {
  tabContextMenus: boolean;
  accessKeys: boolean;
  downloadFilenameSuggestion: boolean;
  downloadDeltaFilename: boolean;
  conflictActionPrompt: boolean;
};

// Mutable cross-file state: reassigned only in this module (by the detection
// block below and `setCurrentBrowser`); other modules import a read-only live
// binding and read it at call time.
export let WEB_EXTENSION_CAPABILITIES: WebExtensionCapabilities = {
  tabContextMenus: false,
  accessKeys: true,
  downloadFilenameSuggestion: false,
  downloadDeltaFilename: false,
  conflictActionPrompt: false,
};
export let CURRENT_BROWSER = BROWSERS.UNKNOWN;
export let CURRENT_BROWSER_VERSION: number | undefined;

export const detectCapabilities = (currentBrowser: string): WebExtensionCapabilities => ({
  // Support for the "tab" context is not exposed as an API property.
  tabContextMenus: currentBrowser === BROWSERS.FIREFOX,
  accessKeys: true,
  downloadFilenameSuggestion:
    currentBrowser === BROWSERS.CHROME &&
    Boolean(globalThis.chrome?.downloads?.onDeterminingFilename),
  // Chrome supplies the final filename through DownloadDelta; Firefox includes
  // it in the initial DownloadItem.
  downloadDeltaFilename: currentBrowser === BROWSERS.CHROME,
  conflictActionPrompt: currentBrowser === BROWSERS.FIREFOX,
});

// The write-half of the browser identity/capability live bindings: they
// always move together (a browser and its feature set), so both detection and
// tests switch browser through here rather than reassigning the pair by hand.
export const setCurrentBrowser = (currentBrowser: string) => {
  CURRENT_BROWSER = currentBrowser; // eslint-disable-line
  WEB_EXTENSION_CAPABILITIES = detectCapabilities(currentBrowser);
};

if (!webExtensionApi) {
  setCurrentBrowser(BROWSERS.UNKNOWN);
} else if (webExtensionApi.runtime.getBrowserInfo) {
  // Only Gecko-based browsers implement getBrowserInfo: treat forks like
  // Waterfox or LibreWolf as Firefox regardless of the reported name (#186)
  setCurrentBrowser(BROWSERS.FIREFOX);

  webExtensionApi.runtime
    .getBrowserInfo()
    .then((res) => {
      CURRENT_BROWSER_VERSION = parseFloat(res.version);
    })
    .catch(() => {});
} else {
  // If we don't have webExtensionApi.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but webExtensionApi.runtime.getBrowserInfo is not well supported
  setCurrentBrowser(BROWSERS.CHROME);
}
