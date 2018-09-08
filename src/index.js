let currentTab = null; // global variable

window.init = () => {
  // FIXME
  window.optionErrors = {
    paths: [],
    filenamePatterns: []
  };

  OptionsManagement.loadOptions()
    .then(browser.contextMenus.removeAll())
    .then(() => {
      Headers.addRequestListener();

      Notification.addNotifications({
        notifyOnSuccess: options.notifyOnSuccess,
        notifyOnFailure: options.notifyOnFailure,
        notifyDuration: options.notifyDuration,
        promptOnFailure: options.promptOnFailure
      });

      const pathsArray = options.paths
        .split("\n")
        .map(p => p.trim())
        .filter(p => p && p.length > 0);

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
    });
};

Menus.addDownloadListener();

window.reset = () => {
  browser.contextMenus.removeAll().then(() => {
    window.init();
  });
};

window.init();

browser.tabs.onActivated.addListener(info => {
  browser.tabs.get(info.tabId).then(t => {
    currentTab = t;
  });
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!currentTab) {
    browser.tabs.get(tabId).then(t => {
      currentTab = t;
    });
  } else if (currentTab.id === tabId && changeInfo.title) {
    currentTab.title = changeInfo.title;
  }
});
