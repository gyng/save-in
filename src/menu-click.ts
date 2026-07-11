import { webExtensionApi } from "./web-extension-api.ts";

// Click handling for the save-in context menu: routes clicks on path
// items (and last-used/route-exclusive) into Download.renameAndDownload.
// Extends the Menus object defined in menu-build.js via the shared
// global scope; tab-strip clicks are handled in menu-tabs.js.

import { Menus } from "./menu-build.ts";
import { DOWNLOAD_TYPES, MEDIA_TYPES } from "./constants.ts";
import { splitLines } from "./util.ts";
import { Path } from "./path.ts";
import { Download } from "./download.ts";
import { Notifier } from "./notification.ts";
import { WEB_EXTENSION_CAPABILITIES } from "./chrome-detector.ts";
import { Shortcut } from "./shortcut.ts";
import { options } from "./options-data.ts";
import { currentTab, CurrentTab } from "./current-tab.ts";
import type { DownloadInfo } from "./download-types.ts";

type ClickInfo = {
  mediaType?: string;
  srcUrl?: string;
  linkUrl?: string;
  pageUrl?: string;
  selectionText?: string;
  linkText?: string;
  modifiers?: string[];
};

type ClickOptions = {
  links?: boolean;
  selection?: boolean;
  page?: boolean;
  truncateLength: number;
  preferLinks?: boolean;
  preferLinksFilterEnabled?: boolean;
  preferLinksFilter?: string;
};

type ClickTarget = {
  downloadType: string;
  url: string | undefined;
  suggestedFilename: string | null;
  selectionText: string | null;
  notifyLinkPreferred: boolean;
  badPatternError: unknown | null;
};

// Pure decision: what does a click on a path item save? Returns the download
// type, the url, and a suggested filename from the click `info` + `options`
// (and the clicked tab, for its title). Returns null when there is nothing
// downloadable. Side effects are described, not performed, so this is unit-
// testable without a browser: a text selection reports its `selectionText`
// (the caller turns it into an object URL) and the link-preference / bad-filter
// notifications come back as `notifyLinkPreferred` / `badPatternError`.
Menus.resolveClickTarget = (
  info: ClickInfo,
  options: ClickOptions,
  clickTab: CurrentTab | null | undefined,
): ClickTarget | null => {
  const hasLink = options.links && info.linkUrl;
  const result: ClickTarget = {
    downloadType: DOWNLOAD_TYPES.UNKNOWN,
    url: undefined,
    suggestedFilename: null,
    selectionText: null,
    notifyLinkPreferred: false,
    badPatternError: null,
  };

  if (info.mediaType && MEDIA_TYPES.includes(info.mediaType)) {
    result.downloadType = DOWNLOAD_TYPES.MEDIA;
    result.url = info.srcUrl;

    if (hasLink) {
      if (options.preferLinks) {
        result.downloadType = DOWNLOAD_TYPES.LINK;
        result.url = info.linkUrl;
        result.notifyLinkPreferred = true;
      }

      if (options.preferLinksFilterEnabled && options.preferLinksFilter) {
        let overrideUrls = false;
        try {
          // splitLines drops empty lines: an empty pattern would compile to
          // `new RegExp("")` and match every page
          splitLines(options.preferLinksFilter)
            .map((s) => new RegExp(s))
            .forEach((re) => {
              if (info.pageUrl?.match(re) != null) {
                overrideUrls = true;
              }
            });
        } catch (err) {
          result.badPatternError = err;
        }

        if (overrideUrls) {
          result.downloadType = DOWNLOAD_TYPES.LINK;
          result.url = info.linkUrl;
          result.notifyLinkPreferred = true;
        }
      }
    }
  } else if (hasLink) {
    result.downloadType = DOWNLOAD_TYPES.LINK;
    result.url = info.linkUrl;
  } else if (options.selection && info.selectionText) {
    result.downloadType = DOWNLOAD_TYPES.SELECTION;
    result.selectionText = info.selectionText;
    result.suggestedFilename = `${Path.truncateIfLongerThan(
      (clickTab && clickTab.title) || info.selectionText,
      options.truncateLength - 14,
    )}.selection.txt`;
  } else if (options.page && info.pageUrl) {
    result.downloadType = DOWNLOAD_TYPES.PAGE;
    result.url = info.pageUrl;
    result.suggestedFilename = (clickTab && clickTab.title) || info.pageUrl;
  } else {
    return null;
  }

  return result;
};

Menus.addDownloadListener = () => {
  webExtensionApi.contextMenus.onClicked.addListener(async (info, tab) => {
    if (Object.values(Menus.IDS.TABSTRIP).includes(info.menuItemId)) {
      return;
    }

    if (info.menuItemId === "options") {
      webExtensionApi.runtime.openOptionsPage();
      return;
    }

    if (info.menuItemId === "show-default-folder") {
      webExtensionApi.downloads.showDefaultFolder();
      return;
    }

    // MV3 service workers restart between events: wait for options
    // and menus to be reinitialised before handling the click
    if (window.ready) {
      await window.ready;
    }

    // Prefer the tab the click happened in: the tracked global can lag
    // behind or belong to another window, and its title is mutated by
    // later tab updates (#172, #188)
    const clickTab = tab || currentTab;

    const menuInfo = Menus.pathMappings[info.menuItemId];

    if (menuInfo || [Menus.IDS.ROUTE_EXCLUSIVE, Menus.IDS.LAST_USED].includes(info.menuItemId)) {
      let menuIndex = menuInfo && menuInfo.menuIndex;
      let comment = menuInfo && menuInfo.comment;

      const target = Menus.resolveClickTarget(info, options, clickTab);
      if (!target) {
        return;
      }

      const downloadType = target.downloadType;
      // A text selection is saved as an object URL of its text (the pure
      // decision only reports the text)
      let url =
        target.selectionText != null ? Download.makeObjectUrl(target.selectionText) : target.url;
      let suggestedFilename = target.suggestedFilename;
      if (!url) {
        return;
      }

      // Fire the notifications the pure decision flagged
      if (target.notifyLinkPreferred && options.notifyOnLinkPreferred) {
        Notifier.createExtensionNotification(
          webExtensionApi.i18n.getMessage("notificationLinkPreferred"),
          url,
        );
      }
      if (target.badPatternError) {
        Notifier.createExtensionNotification(
          webExtensionApi.i18n.getMessage("notificationBadPreferLinksPattern"),
          target.badPatternError,
        );
      }

      let saveIntoPath;

      if (info.menuItemId === Menus.IDS.ROUTE_EXCLUSIVE) {
        saveIntoPath = ".";
      } else if (info.menuItemId === Menus.IDS.LAST_USED) {
        saveIntoPath = Menus.state.lastUsedPath;
        if (window.lastDownloadState && window.lastDownloadState.info) {
          comment = window.lastDownloadState.info.comment;
          menuIndex = window.lastDownloadState.info.menuIndex;
        } else if (Menus.state.lastUsedMeta) {
          // The in-memory lastDownloadState died with the service worker:
          // fall back to the persisted routing metadata so comment/menuindex
          // rules still match after a restart
          comment = Menus.state.lastUsedMeta.comment;
          menuIndex = Menus.state.lastUsedMeta.menuIndex;
        }
      } else {
        saveIntoPath = menuInfo.parsedDir;
        Menus.setLastUsed(saveIntoPath, { comment, menuIndex });
        const title = menuInfo.title || saveIntoPath;

        if (options.enableLastLocation) {
          webExtensionApi.contextMenus.update(Menus.IDS.LAST_USED, {
            title: WEB_EXTENSION_CAPABILITIES.accessKeys ? `${title} (&a)` : title,
            enabled: true,
          });
        }
      }

      const parsedPath = new Path.Path(saveIntoPath);

      const saveAsShortcut =
        (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
        (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
        (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

      if (saveAsShortcut) {
        url = Shortcut.makeShortcut(options.shortcutType, url);

        suggestedFilename = Shortcut.suggestShortcutFilename(
          options.shortcutType,
          downloadType,
          info,
          suggestedFilename,
          options.truncateLength,
        );
      }

      if (suggestedFilename) {
        suggestedFilename = Path.sanitizeFilename(suggestedFilename, options.truncateLength);
      }

      // Organise things by flattening the info struct and only keeping needed info
      const opts: DownloadInfo = {
        currentTab: clickTab,
        linkText: info.linkText,
        now: new Date(),
        pageUrl: info.pageUrl,
        selectionText: info.selectionText,
        sourceUrl: info.srcUrl,
        url, // Changes based off context
        suggestedFilename,
        context: downloadType,
        menuIndex,
        comment,
        modifiers: info.modifiers,
      };

      // keeps track of state of the final path
      const state = {
        path: parsedPath,
        scratch: {},
        info: opts,
      };

      Notifier.expectDownload();
      // Fire-and-forget (renameAndDownload is async); Download.launch logs and
      // reports a terminal failure to the user
      Download.launch(state);

      // Close the tab a "save page" came from, mirroring the tab-strip
      // behavior (#115). Deliberately page-context only: closing the tab
      // under an image/link save would be a surprise.
      if (
        options.closeTabOnSave &&
        downloadType === DOWNLOAD_TYPES.PAGE &&
        clickTab &&
        clickTab.id != null
      ) {
        const tabId = clickTab.id;
        window.setTimeout(() => {
          webExtensionApi.tabs.remove(tabId);
        }, 500);
      }
    }
  });
};
