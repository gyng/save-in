import { webExtensionApi } from "../platform/web-extension-api.ts";

// Tab-strip context menus (`tab` context): menu creation,
// the multi-select highlight counter, and the tab-save click handler.
import { MENU_IDS } from "./menu-build.ts";
import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { Log } from "./log.ts";
import { backgroundRuntime } from "./runtime.ts";
import { runBackgroundTask } from "./event-task.ts";

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
  webExtensionApi.tabs.onHighlighted.addListener((highlightInfo) =>
    runBackgroundTask("tab highlight failed", async () => {
      if (backgroundRuntime.ready) {
        try {
          await backgroundRuntime.ready;
        } catch {
          return;
        }
      }
      if (
        !options.tabEnabled ||
        !WEB_EXTENSION_CAPABILITIES ||
        !WEB_EXTENSION_CAPABILITIES.tabContextMenus
      ) {
        return;
      }

      const length = highlightInfo.tabIds.length;
      await Promise.resolve(
        webExtensionApi.contextMenus.update(MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
          title: webExtensionApi.i18n.getMessage("tabstripMenuMultipleSelectedTab", [length]),
          contexts: ["tab"],
        }),
      ).catch(() => {});
    }),
  );
};

export const addTabMenuListener = () => {
  const ids = Object.values(MENU_IDS.TABSTRIP);

  webExtensionApi.contextMenus.onClicked.addListener((info, fromTab) =>
    runBackgroundTask("tab-strip menu click failed", async () => {
      if (!ids.some((id) => id === info.menuItemId) || !fromTab) {
        return;
      }

      // MV3 service workers restart between events: wait for options
      // and menus to be reinitialised before handling the click
      if (backgroundRuntime.ready) {
        await backgroundRuntime.ready;
      }

      let filter: (tab: browser.tabs.Tab) => boolean = () => false;
      let query: Parameters<typeof webExtensionApi.tabs.query>[0] = {
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

      try {
        const tabs = (await webExtensionApi.tabs.query(query))
          .filter(
            (tab): tab is browser.tabs.Tab & { url: string } =>
              Boolean(tab.url) && !/^(about|chrome):/.test(tab.url || ""),
          )
          .filter(filter);

        // Keep the event handler alive and bound concurrency without relying on
        // timers, which non-persistent MV3/event-page backgrounds may discard.
        for (const t of tabs) {
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

          // Download.launch reports whether the browser accepted the save.
          const result = await Download.launch(state);

          if (options.closeTabOnSave && result.status === "started") {
            const tabId = t.id;
            if (tabId == null) continue;
            try {
              await webExtensionApi.tabs.remove(tabId);
            } catch (error) {
              // The tab may have been closed manually while its save was starting;
              // that must not prevent later tabs in the batch from being saved.
              Log.add("saved tab close failed", String(error));
            }
          }
        }
      } catch (error) {
        // Download.launch reports per-item failures; this catches tab query and
        // batch orchestration failures that occur outside the download pipeline.
        Log.add("tab-strip save failed", String(error));
      }
    }),
  );
};
