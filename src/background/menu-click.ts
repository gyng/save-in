import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import { toggleSourcePanelForTab } from "./source-panel-state.ts";

// Click handling for the save-in context menu: routes clicks on path
// items (and last-used/route-exclusive) into renameAndDownload.
// Tab-strip clicks are handled in menu-tabs.ts.

import {
  clearPrivateLastUsed,
  enablePrivateLastUsedMenu,
  menuState,
  getLastUsed,
  recordRecentDestination,
  setLastUsed,
  setQuickSaveUseDirectory,
  type LastUsedMeta,
  updateLastUsedMenu,
} from "./menu-build.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { resolveDefaultDestination } from "../menus/quick-save-target.ts";
import { DOWNLOAD_TYPES, SPECIAL_DIRS } from "../shared/constants.ts";
import { Path, sanitizeFilename } from "../routing/path.ts";
import { launchDownload, makeObjectUrl } from "../downloads/download.ts";
import {
  createExtensionNotification,
  EXTENSION_NOTIFICATION_STREAMS,
} from "../downloads/notification.ts";
import { makeShortcut, suggestShortcutFilename } from "../downloads/shortcut.ts";
import { createSourceSidecarRequest } from "../downloads/source-sidecar.ts";
import { closeRoutingSourceTab } from "./tab-action.ts";
import { options } from "../config/options-data.ts";
import { currentTab } from "../platform/current-tab.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import type { DownloadInfo, DownloadPipelineState } from "../downloads/download-types.ts";
import { isRoutingAccepted } from "../downloads/download-pipeline-state.ts";
import { backgroundRuntime } from "./runtime.ts";
import { addLogEntry } from "./log.ts";
import { runBackgroundTask } from "./background-event-task.ts";
import { resolveClickTarget, type ClickInfo } from "./menu-target.ts";
import { rebuildMenus } from "./menu-rebuild.ts";
import {
  CONTEXT_LINK_METADATA_REQUEST,
  MAX_CONTEXT_LINK_URL_LENGTH,
  parseContextLinkMetadata,
  type ContextLinkMetadata,
} from "../shared/context-link-metadata.ts";
import { isBrowserTabId } from "../shared/message-protocol.ts";

export { resolveClickTarget } from "./menu-target.ts";

export type ContextMenuClickInfo = ClickInfo & { menuItemId: string | number };

let dynamicLastUsedMenu = false;
type LastUsedMenuContext = "regular" | "private";
let appliedLastUsedMenuContext: LastUsedMenuContext = "regular";
let requestedLastUsedMenuContext: LastUsedMenuContext = "regular";
let lastUsedMenuUpdateQueue: Promise<unknown> = Promise.resolve();
let privateLastUsedMutationQueue: Promise<unknown> = Promise.resolve();
type PrivateMenuInvocation = { windowId: number | undefined; invalidated: boolean };
const activePrivateMenuInvocations = new Set<PrivateMenuInvocation>();
const LINK_METADATA_TIMEOUT_MS = 500;

const usesLinkMetadataVariable = (source: string): boolean => {
  const normalized = source.toLowerCase();
  return (
    normalized.includes(SPECIAL_DIRS.LINK_TITLE) || normalized.includes(SPECIAL_DIRS.LINK_DOWNLOAD)
  );
};

const capturesLinkMetadata = (source: string): boolean =>
  source
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .some((name) => name === "linktitle" || name === "linkdownload");

const usesContextLinkMetadata = (storedDestinationPath?: string): boolean => {
  if (usesLinkMetadataVariable(options.paths)) return true;
  // Last used and recent-destination clicks save into a STORED path string
  // that can still contain :linktitle:/:linkdownload: after the user removed
  // every use of it from options.paths — that stored copy is not options.paths
  // and would otherwise never be scanned here.
  if (storedDestinationPath && usesLinkMetadataVariable(storedDestinationPath)) return true;
  const rules = options.filenamePatterns;
  if (!Array.isArray(rules)) return false;
  return rules.some((rule) =>
    rule.some((clause) => {
      const name = clause.name.toLowerCase();
      if (name === "linktitle" || name === "linkdownload") return true;
      if (name === "capture" || name === "capturegroups") {
        return typeof clause.value === "string" && capturesLinkMetadata(clause.value);
      }
      if (name === "into" || name === "fetch") {
        return typeof clause.value === "string" && usesLinkMetadataVariable(clause.value);
      }
      if (name === "rename") {
        const replacement: unknown = Reflect.get(clause, "replacement");
        return typeof replacement === "string" && usesLinkMetadataVariable(replacement);
      }
      return false;
    }),
  );
};

const readContextLinkMetadata = async (
  info: ContextMenuClickInfo,
  tab: CurrentTab | null | undefined,
  storedDestinationPath?: string,
): Promise<ContextLinkMetadata | null> => {
  if (
    !usesContextLinkMetadata(storedDestinationPath) ||
    !isBrowserTabId(tab?.id) ||
    typeof info.linkUrl !== "string" ||
    info.linkUrl.length > MAX_CONTEXT_LINK_URL_LENGTH
  ) {
    return null;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const messageOptions =
      typeof info.frameId === "number" && Number.isSafeInteger(info.frameId) && info.frameId >= 0
        ? { frameId: info.frameId }
        : undefined;
    const response = await Promise.race([
      webExtensionApi.tabs.sendMessage(
        tab.id,
        { type: CONTEXT_LINK_METADATA_REQUEST, body: { linkUrl: info.linkUrl } },
        messageOptions,
      ),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), LINK_METADATA_TIMEOUT_MS);
      }),
    ]);
    return parseContextLinkMetadata(response, info.linkUrl);
  } catch {
    // Restricted pages, stale content scripts, and navigation races simply
    // leave the optional link metadata blank.
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const getContextMenuListenerRegistrar = (
  eventName: "onShown" | "onHidden",
): ((listener: (...args: never[]) => unknown) => void) | null => {
  const event: unknown = Reflect.get(webExtensionApi.contextMenus, eventName);
  if (event === null || typeof event !== "object") return null;
  const addListener: unknown = Reflect.get(event, "addListener");
  if (typeof addListener !== "function") return null;
  return (listener) => Reflect.apply(addListener, event, [listener]);
};

const getContextMenuRefresh = (): (() => Promise<void>) | null => {
  const refresh: unknown = Reflect.get(webExtensionApi.contextMenus, "refresh");
  if (typeof refresh !== "function") return null;
  return () =>
    Promise.resolve(Reflect.apply(refresh, webExtensionApi.contextMenus, [])).then(() => {});
};

const lastUsedMenuExists = (): boolean =>
  options.enableLastLocation &&
  !options.routeHideFolderChoices &&
  !(options.quickSaveEnabled && options.quickSaveOnly);

const queuePrivateLastUsedMutation = <Result>(work: () => Promise<Result>): Promise<Result> => {
  const pending = privateLastUsedMutationQueue.catch(() => {}).then(work);
  privateLastUsedMutationQueue = pending;
  return pending;
};

const queueLastUsedMenuContext = (
  privateContext: boolean,
  refreshVisibleMenu: boolean,
  refresh: () => Promise<void>,
): Promise<unknown> | null => {
  if (
    !privateContext &&
    requestedLastUsedMenuContext === "regular" &&
    appliedLastUsedMenuContext === "regular"
  ) {
    return null;
  }
  const configurationReady = backgroundRuntime.readyGeneration === backgroundRuntime.generation;
  const knownContext: LastUsedMenuContext =
    privateContext && (!configurationReady || !options.persistPrivateActivity)
      ? "private"
      : "regular";
  if (
    configurationReady &&
    knownContext === requestedLastUsedMenuContext &&
    knownContext === appliedLastUsedMenuContext
  ) {
    return null;
  }
  requestedLastUsedMenuContext = knownContext;
  const pending = lastUsedMenuUpdateQueue
    .catch(() => {})
    .then(async () => {
      if (backgroundRuntime.ready) await backgroundRuntime.ready;
      const context: LastUsedMenuContext =
        privateContext && !options.persistPrivateActivity ? "private" : "regular";
      if (context === requestedLastUsedMenuContext && context === appliedLastUsedMenuContext)
        return;
      requestedLastUsedMenuContext = context;
      if (!lastUsedMenuExists()) return;
      await updateLastUsedMenu(context === "private");
      if (refreshVisibleMenu) await refresh();
      appliedLastUsedMenuContext = context;
    });
  lastUsedMenuUpdateQueue = pending;
  return pending;
};

const registerDynamicLastUsedMenu = (): boolean => {
  appliedLastUsedMenuContext = "regular";
  requestedLastUsedMenuContext = "regular";
  lastUsedMenuUpdateQueue = Promise.resolve();
  const addShown = getContextMenuListenerRegistrar("onShown");
  const addHidden = getContextMenuListenerRegistrar("onHidden");
  const refresh = getContextMenuRefresh();
  if (!addShown || !addHidden || !refresh) return false;

  addShown((_info: unknown, tab?: CurrentTab) => {
    const privateContext = tab?.incognito === true;
    const pending = queueLastUsedMenuContext(privateContext, true, refresh);
    return pending
      ? runBackgroundTask("context menu refresh failed", () => pending, { privateContext })
      : undefined;
  });
  addHidden(() => {
    const pending = queueLastUsedMenuContext(false, false, refresh);
    return pending ? runBackgroundTask("context menu reset failed", () => pending) : undefined;
  });
  return true;
};

const handleContextMenuClickInternal = async (
  info: ContextMenuClickInfo,
  tab?: CurrentTab,
  privateInvocation?: PrivateMenuInvocation,
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

  // The dynamic-default checkbox only flips which destination Quick save
  // resolves to; the browser already toggled its own checked state, so the
  // click state (post-toggle) is authoritative. Await initialization first:
  // a concurrent load must not overwrite the newly persisted in-memory value.
  if (info.menuItemId === MENU_IDS.QUICK_SAVE_TO_DIRECTORY) {
    return setQuickSaveUseDirectory(Reflect.get(info, "checked") === true);
  }

  // Prefer the tab the click happened in: the tracked global can lag
  // behind or belong to another window, and its title is mutated by
  // later tab updates (#172, #188)
  const clickTab = tab || currentTab;
  // Harden the privacy classification independently of which candidate wins
  // above: if the browser ever delivered onClicked without a tab while
  // currentTab pointed at a public one (or vice versa), a private candidate
  // from EITHER source must still classify this click as private.
  const privateContext = tab?.incognito === true || currentTab?.incognito === true;
  const isolatedPrivateContext = privateContext && !options.persistPrivateActivity;

  const menuInfo = menuState.pathMappings[info.menuItemId];
  const isSpecialItem = [MENU_IDS.ROUTE_EXCLUSIVE, MENU_IDS.LAST_USED, MENU_IDS.QUICK_SAVE].some(
    (id) => id === info.menuItemId,
  );

  if (menuInfo || isSpecialItem) {
    let menuIndex: string | null | undefined = menuInfo?.menuIndex;
    let comment: string | null | undefined = menuInfo?.comment;
    let lastUsedMeta: LastUsedMeta | null = null;

    const target = resolveClickTarget(info, options, clickTab);
    if (!target) {
      return;
    }

    const downloadType = target.downloadType;
    // The destination this click is about to resolve to: Last used and
    // recent-destination items save into a stored path string, not
    // options.paths, so the metadata-usage gate must see it too.
    const storedDestinationPath =
      info.menuItemId === MENU_IDS.LAST_USED
        ? (getLastUsed(isolatedPrivateContext).path ?? undefined)
        : menuInfo?.parsedDir;
    const contextLinkMetadata = await readContextLinkMetadata(
      info,
      clickTab,
      storedDestinationPath,
    );
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
        privateContext ? getMessage("notificationPrivateLinkPreferredMessage") : url,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.LINK_PREFERRED,
        { privateContext },
      );
    }
    if (target.badPatternError) {
      createExtensionNotification(
        getMessage("notificationBadPreferLinksPattern"),
        target.badPatternError.message,
        undefined,
        EXTENSION_NOTIFICATION_STREAMS.PREFER_LINKS_PATTERN_ERROR,
        { privateContext },
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

    // The mapped case is checked first so the mapping's presence is what
    // selects the branch: the outer guard admits an ordinary item only when
    // its mapping exists, and testing `menuInfo` directly proves that to the
    // type system. Mapped ids (`save-in-<n>`, `save-in-recent-<n>`) can never
    // collide with the special ids below, so the order does not change which
    // branch a click takes.
    if (menuInfo) {
      const mappedMenu = menuInfo;
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
    } else if (info.menuItemId === MENU_IDS.ROUTE_EXCLUSIVE) {
      saveIntoPath = ".";
    } else if (info.menuItemId === MENU_IDS.QUICK_SAVE) {
      // Quick save reuses the ordinary pipeline: routing rules still run on top
      // of the resolved default destination, only the folder tree is skipped.
      saveIntoPath = resolveDefaultDestination(options);
    } else {
      // Last used: the only remaining id the outer guard admits.
      const lastUsed = getLastUsed(isolatedPrivateContext);
      saveIntoPath = lastUsed.path;
      if (!saveIntoPath) return;
      lastUsedMeta = lastUsed.meta;
      if (lastUsedMeta) {
        // Keep routing metadata paired with the path that produced it. A
        // later tab/external download may replace lastDownloadState, but
        // must not change how the Last used destination routes.
        comment = lastUsedMeta.comment;
        menuIndex = lastUsedMeta.menuIndex;
      }
    }

    const parsedPath = new Path(saveIntoPath);

    const saveAsShortcut =
      (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
      (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
      (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

    if (saveAsShortcut) {
      url = makeShortcut(options.shortcutType, url, clickTab?.title);

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
      linkTitle: contextLinkMetadata?.title,
      linkDownload: contextLinkMetadata?.download,
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
        (info.menuItemId === MENU_IDS.LAST_USED && lastUsedMeta?.prompt),
      modifiers: Array.isArray(modifiersValue)
        ? modifiersValue.filter((value): value is string => typeof value === "string")
        : undefined,
    };

    // keeps track of state of the final path
    // No needRouteMatch: a menu click never requires a route of its own.
    // routeHideFolderChoices only removes the folder submenu, so forcing one
    // here would let a menu-shape setting answer for routeSkipUnmatched and
    // routeFailurePrompt, which own the no-match behavior for every save path.
    const state: DownloadPipelineState = {
      path: parsedPath,
      scratch: {},
      info: opts,
    };

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

    const routingAccepted = isRoutingAccepted(state);
    if (result.status === "started" && routingAccepted && selectedLocation) {
      if (!isolatedPrivateContext) {
        await setLastUsed(selectedLocation.path, selectedLocation.meta);
        const recentDestinationsChanged = await recordRecentDestination(
          selectedLocation.path,
          selectedLocation.meta,
        );
        if (options.enableLastLocation) await updateLastUsedMenu();
        if (options.recentDestinationCount > 0 && recentDestinationsChanged) await rebuildMenus();
      } else {
        await queuePrivateLastUsedMutation(async () => {
          if (privateInvocation?.invalidated) return;
          await setLastUsed(selectedLocation.path, selectedLocation.meta, true);
          if (options.enableLastLocation && !dynamicLastUsedMenu) {
            await enablePrivateLastUsedMenu();
          }
        });
      }
    }

    // The most specific action wins: a menu item's own action, then the matched
    // routing rule, then the page-only global default. Resolve once so two
    // independently enabled settings cannot race two tab API calls.
    const tabAction =
      menuInfo?.tabAction ??
      state.scratch.routeTabAction ??
      (options.closeTabOnSave && downloadType === DOWNLOAD_TYPES.PAGE ? "close" : undefined);
    const routingTabAction = menuInfo?.tabAction == null && state.scratch.routeTabAction != null;
    if (
      routingAccepted &&
      tabAction &&
      result.status === "started" &&
      clickTab &&
      clickTab.id != null
    ) {
      const tabId = clickTab.id;
      try {
        if (tabAction === "close") {
          if (routingTabAction) await closeRoutingSourceTab(clickTab, tabId);
          else await webExtensionApi.tabs.remove(tabId);
        } else {
          await webExtensionApi.tabs.update(tabId, { active: true });
        }
      } catch (error) {
        void addLogEntry("post-save tab action failed", String(error), { privateContext });
      }
    }
  }
};

export const handleContextMenuClick = async (
  info: ContextMenuClickInfo,
  tab?: CurrentTab,
): Promise<void> => {
  const invocationTab = tab || currentTab;
  const privateInvocation: PrivateMenuInvocation | undefined =
    invocationTab?.incognito === true
      ? { windowId: invocationTab.windowId, invalidated: false }
      : undefined;
  if (privateInvocation) activePrivateMenuInvocations.add(privateInvocation);
  try {
    await handleContextMenuClickInternal(info, tab, privateInvocation);
  } finally {
    if (privateInvocation) activePrivateMenuInvocations.delete(privateInvocation);
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
  privateLastUsedMutationQueue = Promise.resolve();
  activePrivateMenuInvocations.clear();
  webExtensionApi.contextMenus.onClicked.addListener((info, tab) =>
    runBackgroundTask("context menu click failed", () => handleContextMenuClick(info, tab), {
      privateContext: tab?.incognito === true,
    }),
  );
  dynamicLastUsedMenu = registerDynamicLastUsedMenu();
  webExtensionApi.windows.onRemoved.addListener((windowId) => {
    for (const invocation of activePrivateMenuInvocations) {
      if (invocation.windowId === undefined || invocation.windowId === windowId) {
        invocation.invalidated = true;
      }
    }
    return runBackgroundTask("private Last used cleanup failed", () =>
      queuePrivateLastUsedMutation(async () => {
        if (backgroundRuntime.ready) await backgroundRuntime.ready;
        if (!menuState.privateLastUsedPath) return;
        const windows = await webExtensionApi.windows.getAll();
        if (windows.some((window) => window.incognito)) return;
        await clearPrivateLastUsed();
      }),
    );
  });
};
