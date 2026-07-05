let currentTab = null; // global variable

// Restore currentTab from session storage so tab matchers work after SW restart
(async () => {
  try {
    const result = await browser.storage.session.get("siCurrentTab");
    if (result.siCurrentTab) {
      currentTab = result.siCurrentTab;
    }
  } catch (e) {
    // session storage not available or first run
  }
})();

self.init = () => {
  // FIXME
  self.optionErrors = {
    paths: [],
    filenamePatterns: [],
  };

  OptionsManagement.loadOptions()
    .then(() => browser.contextMenus.removeAll())
    .then(() => {
      Headers.addRequestListener();

      Notification.addNotifications({
        notifyOnSuccess: options.notifyOnSuccess,
        notifyOnFailure: options.notifyOnFailure,
        notifyDuration: options.notifyDuration,
        promptOnFailure: options.promptOnFailure,
      });

      const pathsArray = options.paths
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p && p.length > 0);

      let contexts = options.links
        ? [...MEDIA_TYPES, "link"]
        : [...MEDIA_TYPES];
      contexts = options.selection ? [...contexts, "selection"] : contexts;
      contexts = options.page ? [...contexts, "page"] : contexts;

      if (options.routeExclusive) {
        Menus.addRouteExclusive(contexts);
        return;
      }
      Menus.addRoot(contexts);

      if (options.enableLastLocation) {
        Menus.addLastUsed(contexts);
        Menus.makeSeparator(contexts);
      }

      Menus.buildFilterCache();
      Menus.addPaths(pathsArray, contexts);
      Menus.makeSeparator(contexts);

      Menus.addSelectionType(contexts);
      Menus.addShowDefaultFolder(contexts);
      Menus.addOptions(contexts);
    });
};

Menus.addDownloadListener();

self.reset = () => {
  browser.contextMenus.removeAll().then(() => {
    self.init();
  });
};

self.init();

browser.tabs.onActivated.addListener((info) => {
  browser.tabs.get(info.tabId).then((t) => {
    currentTab = t;
    browser.storage.session.set({ siCurrentTab: t }).catch(() => {});
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then((t) => {
      currentTab = t;
      browser.storage.session.set({ siCurrentTab: t }).catch(() => {});
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    currentTab.title = changeInfo.title;
  }
});

