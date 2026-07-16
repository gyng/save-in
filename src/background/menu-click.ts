import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { toggleSourcePanelForTab } from "./source-panel-state.ts";

// Click handling for the save-in context menu: routes clicks on path
// items (and last-used/route-exclusive) into renameAndDownload.
// Tab-strip clicks are handled in menu-tabs.ts.

import {
  menuState,
  recordRecentDestination,
  setAccesskey,
  setLastUsed,
  setQuickSaveUseDirectory,
} from "./menu-build.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { resolveDefaultDestination } from "../menus/quick-save-target.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import { Path, sanitizeFilename } from "../routing/path.ts";
import { launchDownload, makeObjectUrl } from "../downloads/download.ts";
import {
  createExtensionNotification,
  EXTENSION_NOTIFICATION_STREAMS,
} from "../downloads/notification.ts";
import { makeShortcut, suggestShortcutFilename } from "../downloads/shortcut.ts";
import { createSourceSidecarRequest } from "../downloads/source-sidecar.ts";
import { options } from "../config/options-data.ts";
import { currentTab } from "../platform/current-tab.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";
import { backgroundRuntime } from "./runtime.ts";
import { addLogEntry } from "./log.ts";
import { runBackgroundTask } from "./background-event-task.ts";
import { resolveClickTarget, type ClickInfo } from "./menu-target.ts";
import { rebuildMenus } from "./menu-rebuild.ts";

export { resolveClickTarget } from "./menu-target.ts";

export type ContextMenuClickInfo = ClickInfo & { menuItemId: string | number };

export const handleContextMenuClick = async (
  info: ContextMenuClickInfo,
  tab?: CurrentTab,
): Promise<void> => {
  if (Object.values(MENU_IDS.TABSTRIP).some((id) => id === info.menuItemId)) {
    return;
  }

  if (info.menuItemId === MENU_IDS.OPTIONS) {
    webExtensionApi.runtime.openOptionsPage();
    return;
  }

  if (info.menuItemId === MENU_IDS.TOGGLE_SOURCE_PANEL) {
    if (tab?.id != null) await toggleSourcePanelForTab(tab.id);
    return;
  }

  if (info.menuItemId === MENU_IDS.SHOW_DEFAULT_FOLDER) {
    webExtensionApi.downloads.showDefaultFolder();
    return;
  }

  // The dynamic-default checkbox only flips which destination Quick save
  // resolves to; the browser already toggled its own checked state, so the
  // click state (post-toggle) is authoritative.
  if (info.menuItemId === MENU_IDS.QUICK_SAVE_TO_DIRECTORY) {
    await setQuickSaveUseDirectory(Reflect.get(info, "checked") === true);
    return;
  }

  // MV3 service workers restart between events: wait for options
  // and menus to be reinitialised before handling the click
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready;
  }

  // Prefer the tab the click happened in: the tracked global can lag
  // behind or belong to another window, and its title is mutated by
  // later tab updates (#172, #188)
  const clickTab = tab || currentTab;

  const menuInfo = menuState.pathMappings[info.menuItemId];
  const isSpecialItem = [MENU_IDS.ROUTE_EXCLUSIVE, MENU_IDS.LAST_USED, MENU_IDS.QUICK_SAVE].some(
    (id) => id === info.menuItemId,
  );

  if (menuInfo || isSpecialItem) {
    let menuIndex: string | null | undefined = menuInfo?.menuIndex;
    let comment: string | null | undefined = menuInfo?.comment;

    const target = resolveClickTarget(info, options, clickTab);
    if (!target) {
      return;
    }

    const downloadType = target.downloadType;
    // A text selection is saved as an object URL of its text (the pure
    // decision only reports the text)
    let url = target.selectionText != null ? makeObjectUrl(target.selectionText) : target.url;
    let suggestedFilename = target.suggestedFilename;
    if (!url) {
      return;
    }
    const originalUrl = url;

    // Fire the notifications the pure decision flagged
    if (target.notifyLinkPreferred && options.notifyOnLinkPreferred) {
      createExtensionNotification(
        getMessage("notificationLinkPreferred"),
        url,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.LINK_PREFERRED,
      );
    }
    if (target.badPatternError) {
      createExtensionNotification(
        getMessage("notificationBadPreferLinksPattern"),
        target.badPatternError.message,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.PREFER_LINKS_PATTERN_ERROR,
      );
    }

    let saveIntoPath;
    let selectedLocation:
      | {
          path: string;
          meta: { comment: string; menuIndex: string; title: string; prompt?: boolean };
          title: string;
        }
      | undefined;

    if (info.menuItemId === MENU_IDS.ROUTE_EXCLUSIVE) {
      saveIntoPath = ".";
    } else if (info.menuItemId === MENU_IDS.QUICK_SAVE) {
      // Quick save reuses the ordinary pipeline: routing rules still run on top
      // of the resolved default destination, only the folder tree is skipped.
      saveIntoPath = resolveDefaultDestination(options);
    } else if (info.menuItemId === MENU_IDS.LAST_USED) {
      saveIntoPath = menuState.lastUsedPath;
      if (!saveIntoPath) return;
      if (menuState.lastUsedMeta) {
        // Keep routing metadata paired with the path that produced it. A
        // later tab/external download may replace lastDownloadState, but
        // must not change how the Last used destination routes.
        comment = menuState.lastUsedMeta.comment;
        menuIndex = menuState.lastUsedMeta.menuIndex;
      }
    } else {
      const mappedMenu = menuInfo;
      /* v8 ignore next -- The outer guard admits an ordinary item only when its mapping exists. */
      if (!mappedMenu) return;
      saveIntoPath = mappedMenu.parsedDir;
      const title = mappedMenu.title || saveIntoPath;
      selectedLocation = {
        path: saveIntoPath,
        meta: {
          comment: mappedMenu.comment,
          menuIndex: mappedMenu.menuIndex,
          title,
          ...(mappedMenu.prompt === true ? { prompt: true } : {}),
        },
        title,
      };
    }

    const parsedPath = new Path(saveIntoPath);

    const saveAsShortcut =
      (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
      (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
      (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

    if (saveAsShortcut) {
      url = makeShortcut(options.shortcutType, url);

      suggestedFilename = suggestShortcutFilename(
        options.shortcutType,
        downloadType,
        info,
        suggestedFilename,
        options.truncateLength,
      );
    }

    if (suggestedFilename) {
      suggestedFilename = sanitizeFilename(suggestedFilename, options.truncateLength, true, true);
    }

    // Organise things by flattening the info struct and only keeping needed info
    const linkTextValue: unknown = Reflect.get(info, "linkText");
    const modifiersValue: unknown = Reflect.get(info, "modifiers");
    const opts: DownloadInfo = {
      currentTab: clickTab,
      frameUrl: info.frameUrl,
      linkText: typeof linkTextValue === "string" ? linkTextValue : undefined,
      mediaType: info.mediaType,
      now: new Date(),
      pageUrl: info.pageUrl,
      selectionText: info.selectionText,
      selectedUrl: target.url || info.pageUrl,
      webhookEligible: true,
      sourceUrl: info.srcUrl,
      url, // Changes based off context
      suggestedFilename,
      context: downloadType,
      menuIndex,
      menuItemId: String(info.menuItemId),
      menuItemTitle:
        selectedLocation?.title ||
        (info.menuItemId === MENU_IDS.LAST_USED
          ? "Last used location"
          : info.menuItemId === MENU_IDS.QUICK_SAVE
            ? "Quick save"
            : "Routing rules"),
      menuItemPath: saveIntoPath,
      comment,
      forcePrompt:
        menuInfo?.prompt === true ||
        (info.menuItemId === MENU_IDS.LAST_USED && menuState.lastUsedMeta?.prompt === true),
      modifiers: Array.isArray(modifiersValue)
        ? modifiersValue.filter((value): value is string => typeof value === "string")
        : undefined,
    };

    // keeps track of state of the final path
    const state: DownloadPipelineState = {
      path: parsedPath,
      scratch: {},
      info: opts,
      needRouteMatch: info.menuItemId === MENU_IDS.ROUTE_EXCLUSIVE,
    };

    const privateContext = clickTab?.incognito === true;
    if (
      !privateContext &&
      options.saveSourceSidecar &&
      downloadType === DOWNLOAD_TYPES.MEDIA &&
      !saveAsShortcut
    ) {
      state.scratch.sourceSidecar = createSourceSidecarRequest(state, originalUrl, clickTab?.title);
    }

    // Fire-and-forget (renameAndDownload is async); launchDownload logs and
    // reports a terminal failure to the user
    const result = await launchDownload(state);

    if (result.status === "started" && selectedLocation && !privateContext) {
      await setLastUsed(selectedLocation.path, selectedLocation.meta);
      const recentDestinationsChanged = await recordRecentDestination(
        selectedLocation.path,
        selectedLocation.meta,
      );
      if (options.enableLastLocation) {
        await webExtensionApi.contextMenus.update(MENU_IDS.LAST_USED, {
          title: setAccesskey(selectedLocation.title, options.keyLastUsed),
          enabled: true,
        });
      }
      if (options.recentDestinationCount > 0 && recentDestinationsChanged) await rebuildMenus();
    }

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
      if (result.status === "started") {
        try {
          await webExtensionApi.tabs.remove(tabId);
        } catch (error) {
          void addLogEntry("saved page tab close failed", String(error), { privateContext });
        }
      }
    }

    // Per-menu-item post-save tab action (#115): only the clicked folder's own
    // opt-in acts, only after the browser accepted the save. tabs.remove and
    // tabs.update need no "tabs" permission (it gates url/title metadata, not
    // these operations), so both browsers behave identically. The source tab id
    // is already known from the click, so acting on it leaks nothing new about a
    // private context.
    const tabAction = menuInfo?.tabAction;
    if (tabAction && result.status === "started" && clickTab && clickTab.id != null) {
      const tabId = clickTab.id;
      try {
        if (tabAction === "close") {
          await webExtensionApi.tabs.remove(tabId);
        } else {
          await webExtensionApi.tabs.update(tabId, { active: true });
        }
      } catch (error) {
        void addLogEntry("post-save tab action failed", String(error), { privateContext });
      }
    }
  }
};

// Keyboard-command entry point (#144): the command has no click context, so it
// saves the active tab's page to the resolved default destination through the
// same handler the menu item uses. Gated on the opt-in so an unbound-by-default
// command that a user assigns still respects the feature toggle.
export const quickSaveActiveTab = async (): Promise<void> => {
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready;
  }
  if (!options.quickSaveEnabled) return;
  const [tab] = await webExtensionApi.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url == null) return;
  await handleContextMenuClick({ menuItemId: MENU_IDS.QUICK_SAVE, pageUrl: tab.url }, tab);
};

export const addDownloadListener = () => {
  webExtensionApi.contextMenus.onClicked.addListener((info, tab) =>
    runBackgroundTask("context menu click failed", () => handleContextMenuClick(info, tab), {
      privateContext: tab?.incognito === true,
    }),
  );
};
