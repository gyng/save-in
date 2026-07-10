// Tab-strip context menus (Firefox-only `tab` context): menu creation,
// the multi-select highlight counter, and the tab-save click handler.
// Extends the Menus object defined in menu-build.js via the shared
// global scope.

Menus.addTabMenus = () => {
  if (!options.tabEnabled) {
    return;
  }

  browser.contextMenus.create({
    id: Menus.IDS.TABSTRIP.SELECTED_TAB,
    title: browser.i18n.getMessage("tabstripMenuSelectedTab"),
    contexts: ["tab"],
  });

  if (BROWSER_FEATURES.multitab) {
    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
      title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [1]),
      contexts: ["tab"],
    });
  }

  browser.contextMenus.create({
    id: Menus.IDS.TABSTRIP.OPENED_FROM_TAB,
    title: browser.i18n.getMessage("tabstripMenuSaveChildrenTabs"),
    contexts: ["tab"],
  });

  browser.contextMenus.create({
    id: Menus.IDS.TABSTRIP.TO_RIGHT,
    title: browser.i18n.getMessage("tabstripMenuSaveRightTabs"),
    contexts: ["tab"],
  });

  browser.contextMenus.create({
    id: Menus.IDS.TABSTRIP.TO_RIGHT_MATCH,
    title: browser.i18n.getMessage("tabstripMenuSaveRightTabsMatched"),
    contexts: ["tab"],
  });
};

Menus.addTabHighlightListener = () => {
  browser.tabs.onHighlighted.addListener((highlightInfo) => {
    if (!options.tabEnabled || !BROWSER_FEATURES || !BROWSER_FEATURES.multitab) {
      return;
    }

    const length = highlightInfo.tabIds.length;
    browser.contextMenus.update(Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
      title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [length]),
      contexts: ["tab"],
    });
  });
};

Menus.addTabMenuListener = () => {
  const ids = Object.values(Menus.IDS.TABSTRIP);

  browser.contextMenus.onClicked.addListener(async (info, fromTab) => {
    if (!ids.includes(info.menuItemId)) {
      return;
    }

    // MV3 service workers restart between events: wait for options
    // and menus to be reinitialised before handling the click
    if (window.ready) {
      await window.ready;
    }

    let filter = () => false;
    let query = {
      pinned: false,
      windowId: fromTab.windowId,
      windowType: "normal",
    };

    switch (info.menuItemId) {
      case Menus.IDS.TABSTRIP.SELECTED_TAB:
        filter = (t) => t.id === fromTab.id;
        break;
      case Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS:
        filter = () => true;
        query = Object.assign(query, { highlighted: true });
        break;
      case Menus.IDS.TABSTRIP.TO_RIGHT:
      case Menus.IDS.TABSTRIP.TO_RIGHT_MATCH:
        filter = (t) => t.index >= fromTab.index;
        break;
      case Menus.IDS.TABSTRIP.OPENED_FROM_TAB:
        filter = () => true;
        query = Object.assign(query, { openerTabId: fromTab.id });
        break;
      default:
        break;
    }

    browser.tabs
      .query(query)
      .then((tabs) => tabs.filter((t) => !t.url.match(/^(about|chrome):/)))
      .then((tabs) => tabs.filter(filter))
      .then((tabs) => {
        const timeoutInterval = 500; // Prevents notification bugs

        tabs.forEach((t, i) => {
          window.setTimeout(() => {
            Notification.expectDownload();

            let url = t.url;
            let suggestedFilename = null;

            if (options.shortcutTab) {
              url = Shortcut.makeShortcut(options.shortcutType, url, t.title || t.url);

              suggestedFilename = Shortcut.suggestShortcutFilename(
                options.shortcutType,
                DOWNLOAD_TYPES.TAB,
                info,
                t.title,
                options.truncateLength,
              );
            }

            const opts = {
              currentTab: t, // Global,
              linkText: t.title,
              now: new Date(),
              pageUrl: t.url,
              selectionText: info.selectionText,
              sourceUrl: t.url,
              url, // Changes based off context
              suggestedFilename, // wip: rename
              context: DOWNLOAD_TYPES.TAB,
              menuIndex: null,
              comment: null,
              modifiers: info.modifiers,
            };

            // keeps track of state of the final path
            const state = {
              path: new Path.Path("."),
              scratch: {},
              info: opts,
              needRouteMatch: info.menuItemId === Menus.IDS.TABSTRIP.TO_RIGHT_MATCH,
            };

            Download.renameAndDownload(state);

            // TODO: Store tabs marked for saving and close only on successful save
            if (options.closeTabOnSave) {
              window.setTimeout(() => {
                browser.tabs.remove(t.id);
              }, timeoutInterval);
            }
          }, timeoutInterval * i);
        });
      });
  });
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
