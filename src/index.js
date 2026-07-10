let currentTab = null; // global variable

window.init = () => {
  window.optionErrors = {
    paths: [],
    filenamePatterns: [],
  };

  return Promise.all([
    OptionsManagement.loadOptions(),
    browser.storage.local.get(["lastUsedPath", "lastUsedMeta"]),
    browser.contextMenus.removeAll(),
  ])
    .then((results) => {
      // MV3 service workers are stateless: restore last used path across restarts
      Menus.state.lastUsedPath = (results[1] && results[1].lastUsedPath) || null;
      Menus.state.lastUsedMeta = (results[1] && results[1].lastUsedMeta) || null;

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
      currentTab = tabs[0];
    }
  })
  .catch(() => {});

browser.tabs.onActivated.addListener((info) => {
  browser.tabs.get(info.tabId).then((t) => {
    currentTab = t;
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then((t) => {
      currentTab = t;
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    currentTab.title = changeInfo.title;
  }
});
