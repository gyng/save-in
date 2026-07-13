// Background composition root; listener registration remains synchronous.
import { webExtensionApi } from "../platform/web-extension-api.ts";

import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { downloadsState } from "./state.ts";
import { hydrateDownloads } from "../downloads/download-state.ts";
import { configureDownloadPorts } from "../downloads/ports.ts";
import { SaveHistory } from "./history.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import {
  addLastUsed,
  addOptions,
  addSourcePanel,
  addPaths,
  addRoot,
  addRouteExclusive,
  addSelectionType,
  addShowDefaultFolder,
  makeSeparator,
  restoreLastUsed,
} from "./menu-build.ts";
import { addDownloadListener } from "./menu-click.ts";
import { addTabHighlightListener, addTabMenuListener, addTabMenus } from "./menu-tabs.ts";
import { splitLines } from "../shared/util.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { LAST_USED_META_STORAGE_KEY, LAST_USED_PATH_STORAGE_KEY } from "../shared/storage-keys.ts";
import { Log } from "./log.ts";
import { currentTab, setCurrentTab } from "../platform/current-tab.ts";
import { configureRoutingPorts } from "../routing/ports.ts";
import { nextCounter, peekCounter } from "./counter.ts";
import { counterWriteState } from "./state.ts";
import { resolveContent } from "../downloads/content-fetch.ts";
import { syncSourcePanelToTab, toggleSourcePanelForTab } from "./source-panel-state.ts";
import { backgroundRuntime, resetRuntimeDiagnostics } from "./runtime.ts";

export const configureBackgroundPorts = () => {
  configureDownloadPorts({ runtime: backgroundRuntime, history: SaveHistory, log: Log });
  configureRoutingPorts({
    getMessage: (key) => webExtensionApi.i18n.getMessage(key),
    getCurrentTab: () => currentTab,
    isDebug: () => backgroundRuntime.debug,
    recordRuleErrors: (errors) => backgroundRuntime.optionErrors.filenamePatterns.push(...errors),
    logDebug: (...values) => console.log(...values), // eslint-disable-line no-console
    nextCounter: () => nextCounter(counterWriteState, webExtensionApi.storage.local),
    peekCounter: () => peekCounter(webExtensionApi.storage.local),
    resolveContent,
  });
};

backgroundRuntime.init = () => {
  resetRuntimeDiagnostics();

  return Promise.all([
    OptionsManagement.loadOptions(),
    webExtensionApi.storage.local.get([LAST_USED_PATH_STORAGE_KEY, LAST_USED_META_STORAGE_KEY]),
    webExtensionApi.contextMenus.removeAll(),
    // Rebuild the in-memory download records from storage.session before any
    // download event handler (which awaits backgroundRuntime.ready) touches them
    hydrateDownloads(downloadsState, extensionSessionStorage),
  ])
    .then((results) => {
      // MV3 service workers are stateless: restore last used path across restarts
      restoreLastUsed(results[1]);

      const pathsArray = splitLines(options.paths);

      let contexts = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
      contexts = options.selection ? contexts.concat(["selection"]) : contexts;
      contexts = options.page ? contexts.concat(["page"]) : contexts;

      addTabMenus();

      if (options.routeExclusive) {
        addRouteExclusive(contexts);
        return;
      } else {
        addRoot(contexts);
      }

      if (options.enableLastLocation) {
        addLastUsed(contexts);
        makeSeparator(contexts);
      }

      addPaths(pathsArray, contexts);
      makeSeparator(contexts);

      addSelectionType(contexts);
      addShowDefaultFolder(contexts);
      addOptions(contexts);
      addSourcePanel(contexts);
    })
    .catch((e) => {
      Log.add("init failed", String(e));
      throw e;
    });
};

backgroundRuntime.reset = () => {
  // Serialize: overlapping inits interleave removeAll() with another
  // generation's create() calls, producing duplicate-id errors and
  // missing/duplicated menu items
  backgroundRuntime.ready = (backgroundRuntime.ready ?? Promise.resolve())
    .catch(() => {})
    .then(() => backgroundRuntime.init());
  return backgroundRuntime.ready;
};

// MV3: entry.background calls this synchronously at startup. Event listeners
// must be registered synchronously, or MV3 service workers/event pages will not
// wake up for the events they missed.
export const start = () => {
  addDownloadListener();
  addTabMenuListener();
  addTabHighlightListener();
  const toggleSources = (tab: browser.tabs.Tab) => {
    if (tab.id != null) void toggleSourcePanelForTab(tab.id);
  };
  webExtensionApi.action?.onClicked.addListener(toggleSources);
  webExtensionApi.commands?.onCommand.addListener((command) => {
    if (command !== "toggle-source-panel") return;
    void webExtensionApi.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => tab && toggleSources(tab));
  });

  const initialTab = webExtensionApi.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (!currentTab && tabs && tabs.length > 0) {
        setCurrentTab(tabs[0]);
      }
    })
    .catch(() => {});
  backgroundRuntime.ready = Promise.all([backgroundRuntime.init(), initialTab]).then(
    ([ready]) => ready,
  );

  webExtensionApi.tabs.onActivated.addListener(async (info) => {
    setCurrentTab(await webExtensionApi.tabs.get(info.tabId));
    await syncSourcePanelToTab(info.tabId);
  });

  webExtensionApi.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!currentTab) {
      setCurrentTab(await webExtensionApi.tabs.get(tabId));
    } else if (currentTab.id === tabId && changeInfo.title) {
      // Mutating a property of the shared tab object (not reassigning the binding)
      currentTab.title = changeInfo.title;
    }
    // A new tab can finish loading its content script after an activation-time
    // restore message. Apply the shared state whenever any tab becomes ready.
    if (changeInfo.status === "complete") {
      await syncSourcePanelToTab(tabId);
    }
  });
};
