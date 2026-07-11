import { OptionsManagement, options } from "./option.ts";
import { DownloadState } from "./download-state.ts";
import { Menus } from "./menu-build.ts";
import { Util } from "./util.ts";
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
    browser.storage.local.get(["lastUsedPath", "lastUsedMeta"]),
    browser.contextMenus.removeAll(),
    // Rebuild the in-memory download records from storage.session before any
    // download event handler (which awaits window.ready) touches them
    DownloadState.hydrate(),
  ])
    .then((results) => {
      // MV3 service workers are stateless: restore last used path across restarts
      Menus.restoreLastUsed(results[1]);

      const pathsArray = Util.splitLines(options.paths);

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

// Event listeners must be registered synchronously on startup, or MV3
// service workers/event pages will not wake up for the events they missed.
Menus.addDownloadListener();
Menus.addTabMenuListener();
Menus.addTabHighlightListener();

window.reset = () => {
  // Serialize: overlapping inits interleave removeAll() with another
  // generation's create() calls, producing duplicate-id errors and
  // missing/duplicated menu items
  window.ready = window.ready.catch(() => {}).then(() => window.init());
  return window.ready;
};

window.ready = window.init();

browser.tabs
  .query({ active: true, currentWindow: true })
  .then((tabs) => {
    if (!currentTab && tabs && tabs.length > 0) {
      setCurrentTab(tabs[0]);
    }
  })
  .catch(() => {});

browser.tabs.onActivated.addListener((info) => {
  browser.tabs.get(info.tabId).then((t) => {
    setCurrentTab(t);
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then((t) => {
      setCurrentTab(t);
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    // Mutating a property of the shared tab object (not reassigning the binding)
    currentTab.title = changeInfo.title;
  }
});
