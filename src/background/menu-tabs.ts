import { webExtensionApi } from "../platform/web-extension-api.ts";

// Tab-strip context menus (Firefox and Chrome 150+ `tab` context): menu creation,
// the multi-select highlight counter, and the tab-save click handler.
import { MENU_IDS } from "./menu-build.ts";
import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { Notifier } from "../downloads/notification.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";

export const addTabMenus = () => {
  if (!options.tabEnabled || !WEB_EXTENSION_CAPABILITIES.tabContextMenus) {
    return;
  }

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.SELECTED_TAB,
    title: webExtensionApi.i18n.getMessage("tabstripMenuSelectedTab"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
    title: webExtensionApi.i18n.getMessage("tabstripMenuMultipleSelectedTab", [1]),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.OPENED_FROM_TAB,
    title: webExtensionApi.i18n.getMessage("tabstripMenuSaveChildrenTabs"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.TO_RIGHT,
    title: webExtensionApi.i18n.getMessage("tabstripMenuSaveRightTabs"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.TO_RIGHT_MATCH,
    title: webExtensionApi.i18n.getMessage("tabstripMenuSaveRightTabsMatched"),
    contexts: ["tab"],
  });
};

export const addTabHighlightListener = () => {
  webExtensionApi.tabs.onHighlighted.addListener((highlightInfo) => {
    if (
      !options.tabEnabled ||
      !WEB_EXTENSION_CAPABILITIES ||
      !WEB_EXTENSION_CAPABILITIES.tabContextMenus
    ) {
      return;
    }

    const length = highlightInfo.tabIds.length;
    webExtensionApi.contextMenus.update(MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
      title: webExtensionApi.i18n.getMessage("tabstripMenuMultipleSelectedTab", [length]),
      contexts: ["tab"],
    });
  });
};

export const addTabMenuListener = () => {
  const ids = Object.values(MENU_IDS.TABSTRIP);

  webExtensionApi.contextMenus.onClicked.addListener(async (info, fromTab) => {
    if (!ids.some((id) => id === info.menuItemId) || !fromTab) {
      return;
    }

    // MV3 service workers restart between events: wait for options
    // and menus to be reinitialised before handling the click
    if (window.ready) {
      await window.ready;
    }

    let filter: (tab: browser.tabs.Tab) => boolean = () => false;
    /** @type {{ pinned: boolean, windowId: number, windowType: browser.tabs.WindowType, highlighted?: boolean, openerTabId?: number }} */
    let query = {
      pinned: false,
      windowId: fromTab.windowId,
      windowType: "normal",
    };

    switch (info.menuItemId) {
      case MENU_IDS.TABSTRIP.SELECTED_TAB:
        filter = (t) => t.id === fromTab.id;
        break;
      case MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS:
        filter = () => true;
        query = Object.assign(query, { highlighted: true });
        break;
      case MENU_IDS.TABSTRIP.TO_RIGHT:
      case MENU_IDS.TABSTRIP.TO_RIGHT_MATCH:
        filter = (t) => t.index >= fromTab.index;
        break;
      case MENU_IDS.TABSTRIP.OPENED_FROM_TAB:
        filter = () => true;
        query = Object.assign(query, { openerTabId: fromTab.id });
        break;
      default:
        break;
    }

    webExtensionApi.tabs
      .query(query as any)
      .then((tabs) =>
        tabs.filter(
          (tab): tab is browser.tabs.Tab & { url: string } =>
            Boolean(tab.url) && !/^(about|chrome):/.test(tab.url || ""),
        ),
      )
      .then((tabs) => tabs.filter(filter))
      .then((tabs) => {
        const timeoutInterval = 500; // Prevents notification bugs

        tabs.forEach((t, i) => {
          window.setTimeout(() => {
            Notifier.expectDownload();

            let url = t.url;
            let suggestedFilename = null;

            if (options.shortcutTab) {
              url = Shortcut.makeShortcut(options.shortcutType, url, t.title || t.url);

              suggestedFilename = Shortcut.suggestShortcutFilename(
                options.shortcutType,
                DOWNLOAD_TYPES.TAB,
                info,
                t.title,
                options.truncateLength,
              );
            }

            const opts: DownloadInfo = {
              currentTab: t, // Global,
              linkText: t.title,
              now: new Date(),
              pageUrl: t.url,
              selectionText: info.selectionText,
              sourceUrl: t.url,
              url, // Changes based off context
              suggestedFilename,
              context: DOWNLOAD_TYPES.TAB,
              menuIndex: null,
              comment: null,
              modifiers: info.modifiers,
            };

            // keeps track of state of the final path
            const state = {
              path: new Path("."),
              scratch: {},
              info: opts,
              needRouteMatch: info.menuItemId === MENU_IDS.TABSTRIP.TO_RIGHT_MATCH,
            };

            // Fire-and-forget async (see menu-click.js / Download.launch)
            Download.launch(state);

            // TODO: Store tabs marked for saving and close only on successful save
            if (options.closeTabOnSave) {
              const tabId = t.id;
              if (tabId == null) {
                return;
              }
              window.setTimeout(() => {
                webExtensionApi.tabs.remove(tabId);
              }, timeoutInterval);
            }
          }, timeoutInterval * i);
        });
      });
  });
};
