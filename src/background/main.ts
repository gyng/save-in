// Background composition root; listener registration remains synchronous.
import { webExtensionApi } from "../platform/web-extension-api.ts";

import { OptionsManagement } from "../config/option.ts";
import { options } from "../config/options-data.ts";
import { BackgroundState } from "./state.ts";
import { hydrateDownloads } from "../downloads/download-state.ts";
import { extensionSessionStorage } from "../platform/storage-areas.ts";
import {
  addLastUsed,
  addOptions,
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
import { Log } from "./log.ts";
import { currentTab, setCurrentTab } from "../platform/current-tab.ts";

window.init = () => {
  window.optionErrors = {
    paths: [],
    filenamePatterns: [],
  };

  return Promise.all([
    OptionsManagement.loadOptions(),
    webExtensionApi.storage.local.get(["lastUsedPath", "lastUsedMeta"]),
    webExtensionApi.contextMenus.removeAll(),
    // Rebuild the in-memory download records from storage.session before any
    // download event handler (which awaits window.ready) touches them
    hydrateDownloads(BackgroundState.downloads, extensionSessionStorage),
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
    })
    .catch((e) => {
      Log.add("init failed", String(e));
      throw e;
    });
};

window.reset = () => {
  // Serialize: overlapping inits interleave removeAll() with another
  // generation's create() calls, producing duplicate-id errors and
  // missing/duplicated menu items
  window.ready = (window.ready ?? Promise.resolve()).catch(() => {}).then(() => window.init());
  return window.ready;
};

// MV3: entry.background calls this synchronously at startup. Event listeners
// must be registered synchronously, or MV3 service workers/event pages will not
// wake up for the events they missed.
export const start = () => {
  addDownloadListener();
  addTabMenuListener();
  addTabHighlightListener();
  webExtensionApi.action?.onClicked.addListener((tab) => {
    if (tab.id != null) {
      void webExtensionApi.tabs
        .sendMessage(tab.id, { type: "TOGGLE_SOURCE_PANEL" })
        .catch(() => {});
    }
  });

  const initialTab = webExtensionApi.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => {
      if (!currentTab && tabs && tabs.length > 0) {
        setCurrentTab(tabs[0]);
      }
    })
    .catch(() => {});
  window.ready = Promise.all([window.init(), initialTab]).then(([ready]) => ready);

  webExtensionApi.tabs.onActivated.addListener(async (info) => {
    setCurrentTab(await webExtensionApi.tabs.get(info.tabId));
  });

  webExtensionApi.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!currentTab) {
      setCurrentTab(await webExtensionApi.tabs.get(tabId));
    } else if (currentTab.id === tabId && changeInfo.title) {
      // Mutating a property of the shared tab object (not reassigning the binding)
      currentTab.title = changeInfo.title;
    }
  });
};
