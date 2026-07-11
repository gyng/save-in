import { webExtensionApi } from "./web-extension-api.ts";

import { OptionsManagement } from "./option.ts";
import { options } from "./options-data.ts";
import { BackgroundState } from "./background-state.ts";
import { hydrateDownloads } from "./download-state.ts";
import { extensionSessionStorage } from "./storage-areas.ts";
import { Menus } from "./menu-build.ts";
import { splitLines } from "./util.ts";
import { MEDIA_TYPES } from "./constants.ts";
import { Log } from "./log.ts";
import { currentTab, setCurrentTab } from "./current-tab.ts";

// menu-click/menu-tabs extend the shared Menus object with the click/tab
// handlers; import them for their side effects BEFORE the addDownloadListener()
// calls below so the methods are attached first.
import "./menu-click.ts";
import "./menu-tabs.ts";

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
      Menus.restoreLastUsed(results[1]);

      const pathsArray = splitLines(options.paths);

      let contexts = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
      contexts = options.selection ? contexts.concat(["selection"]) : contexts;
      contexts = options.page ? contexts.concat(["page"]) : contexts;

      Menus.addTabMenus();

      if (options.routeExclusive) {
        Menus.addRouteExclusive(contexts);
        return;
      } else {
        Menus.addRoot(contexts);
      }

      if (options.enableLastLocation) {
        Menus.addLastUsed(contexts);
        Menus.makeSeparator(contexts);
      }

      Menus.addPaths(pathsArray, contexts);
      Menus.makeSeparator(contexts);

      Menus.addSelectionType(contexts);
      Menus.addShowDefaultFolder(contexts);
      Menus.addOptions(contexts);
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
  Menus.addDownloadListener();
  Menus.addTabMenuListener();
  Menus.addTabHighlightListener();

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
