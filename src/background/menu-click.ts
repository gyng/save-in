import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { toggleSourcePanelForTab } from "./source-panel-state.ts";

// Click handling for the save-in context menu: routes clicks on path
// items (and last-used/route-exclusive) into Download.renameAndDownload.
// Tab-strip clicks are handled in menu-tabs.ts.

import { menuState, setAccesskey, setLastUsed } from "./menu-build.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { DOWNLOAD_TYPES, isMediaType } from "../shared/constants.ts";
import { parseRegularExpressionList } from "../shared/pattern-list.ts";
import { Path, sanitizeFilename, truncateIfLongerThan } from "../routing/path.ts";
import { Download } from "../downloads/download.ts";
import { EXTENSION_NOTIFICATION_STREAMS, Notifier } from "../downloads/notification.ts";
import { Shortcut } from "../downloads/shortcut.ts";
import { options } from "../config/options-data.ts";
import { currentTab } from "../platform/current-tab.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import type { DownloadInfo } from "../downloads/download-types.ts";
import { backgroundRuntime } from "./runtime.ts";
import { Log } from "./log.ts";
import { runBackgroundTask } from "./event-task.ts";

type ClickInfo = {
  frameUrl?: string | undefined;
  mediaType?: string | undefined;
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
  pageUrl?: string | undefined;
  selectionText?: string | undefined;
  linkText?: string | undefined;
  modifiers?: string[] | undefined;
};

export type ContextMenuClickInfo = ClickInfo & { menuItemId: string | number };

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
export const resolveClickTarget = (
  info: ClickInfo,
  clickOptions: ClickOptions,
  clickTab: CurrentTab | null | undefined,
): ClickTarget | null => {
  const hasLink = clickOptions.links && info.linkUrl;
  const result: ClickTarget = {
    downloadType: DOWNLOAD_TYPES.UNKNOWN,
    url: undefined,
    suggestedFilename: null,
    selectionText: null,
    notifyLinkPreferred: false,
    badPatternError: null,
  };

  if (isMediaType(info.mediaType)) {
    result.downloadType = DOWNLOAD_TYPES.MEDIA;
    result.url = info.srcUrl;

    if (hasLink) {
      if (clickOptions.preferLinks) {
        result.downloadType = DOWNLOAD_TYPES.LINK;
        result.url = info.linkUrl;
        result.notifyLinkPreferred = true;
      }

      if (clickOptions.preferLinksFilterEnabled && clickOptions.preferLinksFilter) {
        const parsed = parseRegularExpressionList(clickOptions.preferLinksFilter);
        const overrideUrls =
          parsed.issues.length === 0 &&
          parsed.entries.some(({ value }) => info.pageUrl?.match(value) != null);
        result.badPatternError = parsed.issues[0]?.error ?? null;

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
  } else if (clickOptions.selection && info.selectionText) {
    result.downloadType = DOWNLOAD_TYPES.SELECTION;
    result.selectionText = info.selectionText;
    result.suggestedFilename = `${truncateIfLongerThan(
      (clickTab && clickTab.title) || info.selectionText,
      clickOptions.truncateLength - 14,
    )}.selection.txt`;
  } else if (clickOptions.page && info.pageUrl) {
    result.downloadType = DOWNLOAD_TYPES.PAGE;
    result.url = info.pageUrl;
    result.suggestedFilename = (clickTab && clickTab.title) || info.pageUrl;
  } else {
    return null;
  }

  return result;
};

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
  const isSpecialItem = [MENU_IDS.ROUTE_EXCLUSIVE, MENU_IDS.LAST_USED].some(
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
    let url =
      target.selectionText != null ? Download.makeObjectUrl(target.selectionText) : target.url;
    let suggestedFilename = target.suggestedFilename;
    if (!url) {
      return;
    }

    // Fire the notifications the pure decision flagged
    if (target.notifyLinkPreferred && options.notifyOnLinkPreferred) {
      Notifier.createExtensionNotification(
        getMessage("notificationLinkPreferred"),
        url,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.LINK_PREFERRED,
      );
    }
    if (target.badPatternError) {
      Notifier.createExtensionNotification(
        getMessage("notificationBadPreferLinksPattern"),
        target.badPatternError as string,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.PREFER_LINKS_PATTERN_ERROR,
      );
    }

    let saveIntoPath;
    let selectedLocation:
      | {
          path: string;
          meta: { comment: string; menuIndex: string; title: string };
          title: string;
        }
      | undefined;

    if (info.menuItemId === MENU_IDS.ROUTE_EXCLUSIVE) {
      saveIntoPath = ".";
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
      const selectedMenuInfo = menuInfo!;
      saveIntoPath = selectedMenuInfo.parsedDir;
      const title = selectedMenuInfo.title || saveIntoPath;
      selectedLocation = {
        path: saveIntoPath,
        meta: {
          comment: selectedMenuInfo.comment,
          menuIndex: selectedMenuInfo.menuIndex,
          title,
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
        (info.menuItemId === MENU_IDS.LAST_USED ? "Last used location" : "Routing rules"),
      menuItemPath: saveIntoPath,
      comment,
      modifiers: Array.isArray(modifiersValue)
        ? modifiersValue.filter((value): value is string => typeof value === "string")
        : undefined,
    };

    // keeps track of state of the final path
    const state = {
      path: parsedPath,
      scratch: {},
      info: opts,
      needRouteMatch: info.menuItemId === MENU_IDS.ROUTE_EXCLUSIVE,
    };

    // Fire-and-forget (renameAndDownload is async); Download.launch logs and
    // reports a terminal failure to the user
    const result = await Download.launch(state);

    const privateContext = clickTab?.incognito === true;
    if (result.status === "started" && selectedLocation && !privateContext) {
      await setLastUsed(selectedLocation.path, selectedLocation.meta);
      if (options.enableLastLocation) {
        await webExtensionApi.contextMenus.update(MENU_IDS.LAST_USED, {
          title: setAccesskey(selectedLocation.title, options.keyLastUsed),
          enabled: true,
        });
      }
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
          Log.add("saved page tab close failed", String(error));
        }
      }
    }
  }
};

export const addDownloadListener = () => {
  webExtensionApi.contextMenus.onClicked.addListener((info, tab) =>
    runBackgroundTask("context menu click failed", () => handleContextMenuClick(info, tab)),
  );
};
