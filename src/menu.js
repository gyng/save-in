const Menus = {
  IDS: {
    TABSTRIP: {
      SELECTED_TAB: "save-in-_-_-SI-selected-tab",
      TO_RIGHT: "save-in-_-_-SI-to-right",
      TO_RIGHT_MATCH: "save-in-_-_-SI-to-right-match",
      OPENED_FROM_TAB: "save-in-_-_-SI-opened-from-tab"
    }
  },

  makeSeparator: (() => {
    let separatorCounter = 0;

    const makeSeparatorInner = contexts => {
      browser.contextMenus.create({
        id: `separator-${separatorCounter}`,
        type: "separator",
        contexts,
        parentId: "save-in-_-_-root"
      });
      separatorCounter += 1;
    };

    return makeSeparatorInner;
  })(),

  addTabMenus: () => {
    if (!options.tabEnabled) {
      return;
    }

    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.SELECTED_TAB,
      title: browser.i18n.getMessage("tabstripMenuSelectedTab"),
      contexts: ["tab"]
    });

    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.OPENED_FROM_TAB,
      title: browser.i18n.getMessage("tabstripMenuSaveChildrenTabs"),
      contexts: ["tab"]
    });

    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.TO_RIGHT,
      title: browser.i18n.getMessage("tabstripMenuSaveRightTabs"),
      contexts: ["tab"]
    });

    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.TO_RIGHT_MATCH,
      title: browser.i18n.getMessage("tabstripMenuSaveRightTabsMatched"),
      contexts: ["tab"]
    });

    const ids = Object.values(Menus.IDS.TABSTRIP);

    browser.contextMenus.onClicked.addListener((info, fromTab) => {
      if (!ids.includes(info.menuItemId)) {
        return;
      }

      let filter = () => false;
      let query = {
        pinned: false,
        windowId: fromTab.windowId,
        windowType: "normal"
      };

      switch (info.menuItemId) {
        case Menus.IDS.TABSTRIP.SELECTED_TAB:
          filter = t => t.id === fromTab.id;
          break;
        case Menus.IDS.TABSTRIP.TO_RIGHT:
        case Menus.IDS.TABSTRIP.TO_RIGHT_MATCH:
          filter = t => t.index >= fromTab.index;
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
        .then(tabs => tabs.filter(t => !t.url.match(/^(about|chrome):/)))
        .then(tabs => tabs.filter(filter))
        .then(tabs => {
          const timeoutInterval = 500; // Prevents notification bugs

          tabs.forEach((t, i) => {
            window.setTimeout(() => {
              requestedDownloadFlag = true; // Notifications.

              let url = t.url;
              let suggestedFilename = null;

              if (options.shortcutTab) {
                url = Shortcut.makeShortcut(
                  options.shortcutType,
                  url,
                  t.title || t.url
                );

                suggestedFilename = Shortcut.suggestShortcutFilename(
                  options.shortcutType,
                  DOWNLOAD_TYPES.TAB,
                  info,
                  t.title,
                  options.truncateLength
                );
              }

              const opts = {
                currentTab: t, // Global
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
                legacyDownloadInfo: info // wip, remove
              };

              // keeps track of state of the final path
              const state = {
                path: new Path.Path("."),
                scratch: {},
                info: opts,
                needRouteMatch:
                  info.menuItemId === Menus.IDS.TABSTRIP.TO_RIGHT_MATCH
              };

              Download.renameAndDownload(state);
            }, timeoutInterval * i);
          });
        });
    });
  }
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
