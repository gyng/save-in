import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

// Tab-strip context menus (`tab` context): menu creation,
// the multi-select highlight counter, and the tab-save click handler.
import { MENU_IDS } from "../menus/menu-ids.ts";
import { options } from "../config/options-data.ts";
import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { makeShortcut, suggestShortcutFilename } from "../downloads/shortcut.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { Download } from "../downloads/download.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { Log } from "./log.ts";
import { backgroundRuntime } from "./runtime.ts";
import { runBackgroundTask } from "./event-task.ts";
import { isDownloadableTab } from "./downloadable-tab.ts";
import type { ClickInfo } from "./menu-target.ts";

export type HostTab = Parameters<
  Parameters<typeof webExtensionApi.tabs.onUpdated.addListener>[0]
>[2];
export type TabMenuClickInfo = ClickInfo & { menuItemId: string | number };

export const addTabMenus = () => {
  if (!options.tabEnabled || !WEB_EXTENSION_CAPABILITIES.tabContextMenus) {
    return;
  }

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.SELECTED_TAB,
    title: getMessage("tabstripMenuSelectedTab"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
    title: getMessage("tabstripMenuMultipleSelectedTab", [1]),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.OPENED_FROM_TAB,
    title: getMessage("tabstripMenuSaveChildrenTabs"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.TO_RIGHT,
    title: getMessage("tabstripMenuSaveRightTabs"),
    contexts: ["tab"],
  });

  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TABSTRIP.TO_RIGHT_MATCH,
    title: getMessage("tabstripMenuSaveRightTabsMatched"),
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
      if (!options.tabEnabled || !WEB_EXTENSION_CAPABILITIES.tabContextMenus) {
        return;
      }

      const length = highlightInfo.tabIds.length;
      await Promise.resolve(
        webExtensionApi.contextMenus.update(MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
          title: getMessage("tabstripMenuMultipleSelectedTab", [length]),
          contexts: ["tab"],
        }),
      ).catch(() => {});
    }),
  );
};

export const handleTabMenuClick = async (
  info: TabMenuClickInfo,
  fromTab?: HostTab,
): Promise<void> => {
  const ids = Object.values(MENU_IDS.TABSTRIP);
  if (!ids.some((id) => id === info.menuItemId) || !fromTab) return;

  // MV3 service workers restart between events: wait for options
  // and menus to be reinitialised before handling the click
  if (backgroundRuntime.ready) await backgroundRuntime.ready;

  let filter: (tab: HostTab) => boolean = () => true;
  let query: Parameters<typeof webExtensionApi.tabs.query>[0] = {
    windowId: fromTab.windowId,
    windowType: "normal",
  };

  switch (info.menuItemId) {
    case MENU_IDS.TABSTRIP.SELECTED_TAB:
      filter = (t) => t.id === fromTab.id;
      break;
    case MENU_IDS.TABSTRIP.SELECTED_MULTIPLE_TABS:
      query = Object.assign(query, { highlighted: true });
      break;
    case MENU_IDS.TABSTRIP.TO_RIGHT:
    case MENU_IDS.TABSTRIP.TO_RIGHT_MATCH:
      filter = (t) => t.index >= fromTab.index;
      break;
    case MENU_IDS.TABSTRIP.OPENED_FROM_TAB:
      query = Object.assign(query, { openerTabId: fromTab.id });
      break;
  }

  try {
    const tabs = (await webExtensionApi.tabs.query(query)).filter(isDownloadableTab).filter(filter);

    // Keep the event handler alive and bound concurrency without relying on
    // timers, which non-persistent MV3/event-page backgrounds may discard.
    for (const t of tabs) {
      let url = t.url;
      let suggestedFilename = null;

      if (options.shortcutTab) {
        url = makeShortcut(options.shortcutType, url, t.title || t.url);

        suggestedFilename = suggestShortcutFilename(
          options.shortcutType,
          DOWNLOAD_TYPES.TAB,
          info,
          t.title,
          options.truncateLength,
        );
      }

      const modifiersValue: unknown = Reflect.get(info, "modifiers");

      const opts: DownloadInfo = {
        currentTab: t, // Global,
        linkText: t.title,
        now: new Date(),
        pageUrl: t.url,
        selectionText: info.selectionText,
        selectedUrl: t.url,
        webhookEligible: true,
        sourceUrl: t.url,
        url, // Changes based off context
        suggestedFilename,
        context: DOWNLOAD_TYPES.TAB,
        menuIndex: null,
        comment: null,
        modifiers: Array.isArray(modifiersValue)
          ? modifiersValue.filter((value): value is string => typeof value === "string")
          : undefined,
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
          await Log.add("saved tab close failed", String(error), {
            privateContext: t.incognito === true,
          });
        }
      }
    }
  } catch (error) {
    // Download.launch reports per-item failures; this catches tab query and
    // batch orchestration failures that occur outside the download pipeline.
    await Log.add("tab-strip save failed", String(error), {
      privateContext: fromTab.incognito === true,
    });
  }
};

export const addTabMenuListener = () => {
  webExtensionApi.contextMenus.onClicked.addListener((info, fromTab) =>
    runBackgroundTask("tab-strip menu click failed", () => handleTabMenuClick(info, fromTab), {
      privateContext: fromTab?.incognito === true,
    }),
  );
};
