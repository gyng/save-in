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
  menuItemIcons: boolean;
  shortcutFileExtensions: boolean;
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
  menuItemIcons: false,
  shortcutFileExtensions: false,
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
  // Chrome has supported the "prompt" conflict action since 28; Firefox has
  // never implemented it and fails the download outright, which is what #89
  // and #217 reported. The schema downgrades an imported prompt on Firefox.
  conflictActionPrompt: currentBrowser === BROWSERS.CHROME,
  // Chrome rejects Referer in downloads.DownloadOptions as an unsafe header.
  downloadRequestHeaders: currentBrowser === BROWSERS.FIREFOX,
  // Firefox's notifications.create rejects the buttons property outright
  // (and exposes no onButtonClicked), so button-bearing notifications are
  // Chrome-only progressive enhancement.
  notificationButtons: currentBrowser === BROWSERS.CHROME,
  // The mirror of notificationButtons: Chrome's contextMenus.create rejects the
  // icons property outright, and does it by schema validation — a synchronous
  // throw ("Error at parameter 'createProperties': Unexpected property:
  // 'icons'", measured on 150), not a lastError. So it cannot be asked politely,
  // and asking anyway made an exception the control flow of every menu build.
  // Firefox honours icons on submenu items — not the root, where the create
  // fails and takes every child with it (see addRoot) — which is what themes
  // the menu (#184).
  menuItemIcons: currentBrowser === BROWSERS.FIREFOX,
  // Firefox 112 (bug 1815062 / CVE-2023-29542) moved the dangerous-extension
  // check into the sanitizer downloads.download validates its filename against,
  // and never gave the extension API the allowInvalidFilenames opt-out the
  // file-picker callers got. A name ending .url/.desktop/.lnk/.scf/.local now
  // fails the whole download with "filename must not contain illegal
  // characters" (#207, reproduced on a current Firefox). Firefox always passes
  // filename — browserFilenameResolution needs downloadFilenameSuggestion,
  // which is Chrome-only — so it is always validated. Every supported Firefox
  // (121+) is past 112, so this is a browser fact, not a version probe.
  shortcutFileExtensions: currentBrowser !== BROWSERS.FIREFOX,
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
