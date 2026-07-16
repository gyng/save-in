import { webExtensionApi } from "./web-extension-api.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

export const BROWSERS = {
  CHROME: "CHROME",
  FIREFOX: "FIREFOX",
  UNKNOWN: "UNKNOWN",
};

export type WebExtensionCapabilities = {
  tabContextMenus: boolean;
  downloadFilenameSuggestion: boolean;
  downloadDeltaFilename: boolean;
  conflictActionPrompt: boolean;
  downloadRequestHeaders: boolean;
  notificationButtons: boolean;
};

// Mutable cross-file state: reassigned only in this module (by the detection
// block below and `setCurrentBrowser`); other modules import a read-only live
// binding and read it at call time.
export let WEB_EXTENSION_CAPABILITIES: WebExtensionCapabilities = {
  tabContextMenus: false,
  downloadFilenameSuggestion: false,
  downloadDeltaFilename: false,
  conflictActionPrompt: false,
  downloadRequestHeaders: false,
  notificationButtons: false,
};
export let CURRENT_BROWSER = BROWSERS.UNKNOWN;
export let CURRENT_BROWSER_VERSION: number | undefined;

const supportsChromeTabContextMenus = (): boolean => {
  const contextMenus = globalThis.chrome?.contextMenus;
  const contextTypes = contextMenus && Reflect.get(contextMenus, "ContextType");
  return (
    contextTypes != null &&
    typeof contextTypes === "object" &&
    Reflect.get(contextTypes, "TAB") === "tab"
  );
};

export const detectCapabilities = (currentBrowser: string): WebExtensionCapabilities => ({
  // Chrome only exposed tab-strip context menus well after our minimum
  // version. Its runtime enum is the synchronous feature probe available
  // before listeners and menus must be registered.
  tabContextMenus:
    currentBrowser === BROWSERS.FIREFOX ||
    (currentBrowser === BROWSERS.CHROME && supportsChromeTabContextMenus()),
  downloadFilenameSuggestion: Boolean(globalThis.chrome?.downloads?.onDeterminingFilename),
  // Chrome supplies the final filename through DownloadDelta; Firefox includes
  // it in the initial DownloadItem.
  downloadDeltaFilename: currentBrowser === BROWSERS.CHROME,
  conflictActionPrompt: currentBrowser === BROWSERS.FIREFOX,
  // Chrome rejects Referer in downloads.DownloadOptions as an unsafe header.
  downloadRequestHeaders: currentBrowser === BROWSERS.FIREFOX,
  // Firefox's notifications.create rejects the buttons property outright
  // (and exposes no onButtonClicked), so button-bearing notifications are
  // Chrome-only progressive enhancement.
  notificationButtons: currentBrowser === BROWSERS.CHROME,
});

// The write-half of the browser identity/capability live bindings: they
// always move together (a browser and its feature set), so both detection and
// tests switch browser through here rather than reassigning the pair by hand.
export const setCurrentBrowser = (currentBrowser: string) => {
  CURRENT_BROWSER = currentBrowser;
  WEB_EXTENSION_CAPABILITIES = detectCapabilities(currentBrowser);
};

const getBrowserInfoValue: unknown = Reflect.get(webExtensionApi?.runtime ?? {}, "getBrowserInfo");
const getBrowserInfo =
  typeof getBrowserInfoValue === "function"
    ? async (): Promise<unknown> => Reflect.apply(getBrowserInfoValue, webExtensionApi.runtime, [])
    : null;

const browserVersion = (value: unknown): number | undefined => {
  if (!isStringKeyedRecord(value) || typeof value.version !== "string") return undefined;
  const majorText = /^(\d+)(?:\.[0-9A-Za-z]+)*$/.exec(value.version)?.[1];
  if (majorText === undefined) return undefined;

  const major = Number(majorText);
  return Number.isSafeInteger(major) ? major : undefined;
};

if (!webExtensionApi) {
  setCurrentBrowser(BROWSERS.UNKNOWN);
} else if (getBrowserInfo) {
  // Only Gecko-based browsers implement getBrowserInfo: treat forks like
  // Waterfox or LibreWolf as Firefox regardless of the reported name (#186)
  setCurrentBrowser(BROWSERS.FIREFOX);

  getBrowserInfo()
    .then((res) => {
      CURRENT_BROWSER_VERSION = browserVersion(res);
    })
    .catch(() => {});
} else {
  // If we don't have webExtensionApi.runtime.getBrowserInfo, assume it's Chrome
  // Big assumption, but webExtensionApi.runtime.getBrowserInfo is not well supported
  setCurrentBrowser(BROWSERS.CHROME);
}
