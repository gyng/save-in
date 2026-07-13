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
  downloadRequestHeaders: boolean;
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
  downloadRequestHeaders: false,
};
export let CURRENT_BROWSER = BROWSERS.UNKNOWN;
export let CURRENT_BROWSER_VERSION: number | undefined;

export const detectCapabilities = (currentBrowser: string): WebExtensionCapabilities => ({
  // `ContextType` is an API type, not a reliably exposed runtime enum. Both
  // declared minimum browsers accept the documented literal `"tab"`.
  tabContextMenus: currentBrowser === BROWSERS.FIREFOX || currentBrowser === BROWSERS.CHROME,
  accessKeys: true,
  downloadFilenameSuggestion: Boolean(globalThis.chrome?.downloads?.onDeterminingFilename),
  // Chrome supplies the final filename through DownloadDelta; Firefox includes
  // it in the initial DownloadItem.
  downloadDeltaFilename: currentBrowser === BROWSERS.CHROME,
  conflictActionPrompt: currentBrowser === BROWSERS.FIREFOX,
  // Chrome rejects Referer in downloads.DownloadOptions as an unsafe header.
  downloadRequestHeaders: currentBrowser === BROWSERS.FIREFOX,
});

// The write-half of the browser identity/capability live bindings: they
// always move together (a browser and its feature set), so both detection and
// tests switch browser through here rather than reassigning the pair by hand.
export const setCurrentBrowser = (currentBrowser: string) => {
  CURRENT_BROWSER = currentBrowser; // eslint-disable-line
  WEB_EXTENSION_CAPABILITIES = detectCapabilities(currentBrowser);
};

const getBrowserInfoValue: unknown = Reflect.get(webExtensionApi?.runtime ?? {}, "getBrowserInfo");
const getBrowserInfo =
  typeof getBrowserInfoValue === "function"
    ? (): Promise<{ version: string }> =>
        Reflect.apply(getBrowserInfoValue, webExtensionApi.runtime, []) as Promise<{
          version: string;
        }>
    : null;

if (!webExtensionApi) {
  setCurrentBrowser(BROWSERS.UNKNOWN);
} else if (getBrowserInfo) {
  // Only Gecko-based browsers implement getBrowserInfo: treat forks like
  // Waterfox or LibreWolf as Firefox regardless of the reported name (#186)
  setCurrentBrowser(BROWSERS.FIREFOX);

  getBrowserInfo()
    .then((res) => {
      CURRENT_BROWSER_VERSION = parseFloat(res.version);
    })
    .catch(() => {});
} else {
  // If we don't have webExtensionApi.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but webExtensionApi.runtime.getBrowserInfo is not well supported
  setCurrentBrowser(BROWSERS.CHROME);
}
