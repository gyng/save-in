let lastUsedPath = null; // global variable

const Menus = {
  IDS: {
    TABSTRIP: {
      SELECTED_TAB: "save-in-_-_-SI-selected-tab",
      SELECTED_MULTIPLE_TABS: "save-in-_-_-SI-selected-multiple-tabs",
      TO_RIGHT: "save-in-_-_-SI-to-right",
      TO_RIGHT_MATCH: "save-in-_-_-SI-to-right-match",
      OPENED_FROM_TAB: "save-in-_-_-SI-opened-from-tab"
    },
    ROOT: "save-in-_-_-root",
    LAST_USED: "save-in-_-_-last-used"
  },

  titles: {},

  makeSeparator: (() => {
    let separatorCounter = 0;

    const makeSeparatorInner = contexts => {
      browser.contextMenus.create({
        id: `separator-${separatorCounter}`,
        type: "separator",
        contexts,
        parentId: Menus.IDS.ROOT
      });
      separatorCounter += 1;
    };

    return makeSeparatorInner;
  })(),

  setAccesskey: (str, key) => {
    if (!BROWSER_FEATURES.accessKeys) {
      return str;
    }

    if (str.includes(key)) {
      return str.replace(key, `&${key}`);
    } else {
      return `${str} (&${key})`;
    }
  },

  addRoot: contexts => {
    browser.contextMenus.create({
      id: Menus.IDS.ROOT,
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuRoot"),
        options.keyRoot
      ),
      contexts
    });
  },

  addRouteExclusive: contexts => {
    browser.contextMenus.create({
      id: "save-in-_-_-route-exclusive",
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuExclusive"),
        options.keyRoot
      ),
      contexts
    });
  },

  addSelectionType: contexts => {
    if (contexts.includes("link")) {
      browser.contextMenus.create({
        id: "download-context-media-link",
        title: browser.i18n.getMessage("contextMenuContextMediaOrLink"),
        enabled: false,
        contexts: MEDIA_TYPES.concat("link"),
        parentId: Menus.IDS.ROOT
      });
    } else {
      browser.contextMenus.create({
        id: "download-context-media",
        title: browser.i18n.getMessage("contextMenuContextMedia"),
        enabled: false,
        contexts: MEDIA_TYPES,
        parentId: Menus.IDS.ROOT
      });
    }

    if (contexts.includes("selection")) {
      browser.contextMenus.create({
        id: "download-context-selection",
        title: browser.i18n.getMessage("contextMenuContextSelection"),
        enabled: false,
        contexts: ["selection"],
        parentId: Menus.IDS.ROOT
      });
    }

    if (contexts.includes("page")) {
      browser.contextMenus.create({
        id: "download-context-page",
        title: browser.i18n.getMessage("contextMenuContextPage"),
        enabled: false,
        contexts: ["page"],
        parentId: Menus.IDS.ROOT
      });
    }
  },

  addOptions: contexts => {
    browser.contextMenus.create({
      id: "options",
      title: browser.i18n.getMessage("contextMenuItemOptions"),
      contexts,
      parentId: "save-in-_-_-root"
    });

    browser.contextMenus.onClicked.addListener(info => {
      if (info.menuItemId === "options") {
        browser.runtime.openOptionsPage();
      }
    });
  },

  addShowDefaultFolder: contexts => {
    browser.contextMenus.create({
      id: "show-default-folder",
      title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
      contexts,
      parentId: Menus.IDS.ROOT
    });

    browser.contextMenus.onClicked.addListener(info => {
      if (info.menuItemId === "show-default-folder") {
        browser.downloads.showDefaultFolder();
      }
    });
  },

  addLastUsed: contexts => {
    const lastUsedTitle =
      lastUsedPath || browser.i18n.getMessage("contextMenuLastUsed");
    const lastUsedMenuOptions = {
      id: Menus.IDS.LAST_USED,
      title: Menus.setAccesskey(lastUsedTitle, options.keyLastUsed),
      enabled: lastUsedPath ? true : false, // eslint-disable-line
      contexts,
      parentId: Menus.IDS.ROOT
    };

    // Chrome, FF < 57 crash when icons is supplied
    // There is no easy way to detect support, so use a try/catch
    try {
      browser.contextMenus.create(
        Object.assign({}, lastUsedMenuOptions, {
          icons: {
            "16": "icons/ic_update_black_24px.svg"
          }
        })
      );
    } catch (e) {
      browser.contextMenus.create(lastUsedMenuOptions);
    }
  },

  parseMeta: comment => {
    const matches = comment.match(/\(.+?:.+?\)+/g);

    if (!matches) {
      return {};
    }

    return matches
      .map(pair =>
        pair
          .replace(/(^\(|\)$)/g, "")
          .split(":")
          .map(val => val.trim())
      )
      .reduce((acc, kv) => {
        const key = kv[0];
        return Object.assign(acc, { [key]: kv.slice(1).join(" ") });
      }, {});
  },

  parsePath: dir => {
    const tokens = dir.split("//").map(tok => tok.trim());
    const depthMatch = tokens[0].match(/^(>+)?(.+)/);
    const arrows = depthMatch[1] || "";
    const depth = arrows.length;
    const parsedDir = depthMatch[2].trim();
    const validation = new Path.Path(parsedDir).validate();
    const comment = (tokens[1] || "").trim();
    const meta = Menus.parseMeta(comment);

    return {
      raw: dir,
      comment,
      depth,
      meta,
      parsedDir,
      validation
    };
  },

  addPaths: (pathsArray, contexts) => {
    const menuItemCounter = { 0: 0 };

    // Create a stack for nested menus
    let pathsNestingStack = [];
    let lastDepth = 0;

    // TODO: Refactor this
    // 1. Make a pass to parse dir types
    // 2. Parse comments
    // 3. Parse depth
    // 4. Construct menu items
    pathsArray.forEach((dir, i) => {
      // HACK
      if (dir === SPECIAL_DIRS.SEPARATOR) {
        Menus.makeSeparator(contexts);
      } else {
        const parsed = Menus.parsePath(dir);

        const { comment, depth, meta, validation, parsedDir } = parsed;

        if (!validation.valid) {
          window.optionErrors.paths.push({
            message: validation.message,
            error: `${dir}`
          });

          return;
        }

        const title = meta.alias != null ? meta.alias : parsedDir;

        if (menuItemCounter[depth] != null) {
          menuItemCounter[depth] += 1;
        } else {
          menuItemCounter[depth] = 1;
        }
        const id = `save-in-${
          menuItemCounter[depth]
        }-${`${i}${comment}`}-${parsedDir}`;

        let parentId;
        if (depth === 0) {
          parentId = Menus.IDS.ROOT;
        } else if (depth > pathsNestingStack.length) {
          parentId = pathsNestingStack[pathsNestingStack.length - 1];
        } else {
          parentId = pathsNestingStack[depth - 1];
        }

        if (depth === 0) {
          pathsNestingStack = [id];
        } else if (depth <= lastDepth) {
          pathsNestingStack[depth] = id;
        } else if (depth > lastDepth) {
          pathsNestingStack.push(id);
        }
        lastDepth = depth;
        pathsNestingStack = pathsNestingStack.slice(0, depth + 1);

        Menus.titles[id] = title;

        browser.contextMenus.create({
          id,
          title: options.enableNumberedItems
            ? Menus.setAccesskey(title, menuItemCounter[depth])
            : title,
          contexts,
          parentId
        });
      }
    });
  },

  // TODO: refactor this to handle only paths, add tests
  addDownloadListener: () => {
    browser.contextMenus.onClicked.addListener(info => {
      if (Object.values(Menus.IDS.TABSTRIP).includes(info.menuItemId)) {
        return;
      }

      const matchSave = info.menuItemId.match(/save-in-(\d|_)+-(.*?)-(.*)/);

      if (matchSave && matchSave.length === 4) {
        let menuIndex = matchSave[1];
        let comment = matchSave[2];
        const matchedDir = matchSave[3];

        let url;
        let suggestedFilename = null;
        let downloadType = DOWNLOAD_TYPES.UNKNOWN;

        const hasLink = options.links && info.linkUrl;

        if (MEDIA_TYPES.includes(info.mediaType)) {
          downloadType = DOWNLOAD_TYPES.MEDIA;
          url = info.srcUrl;

          if (hasLink && options.preferLinks) {
            downloadType = DOWNLOAD_TYPES.LINK;
            url = info.linkUrl;
          }
        } else if (hasLink) {
          downloadType = DOWNLOAD_TYPES.LINK;
          url = info.linkUrl;
        } else if (options.selection && info.selectionText) {
          downloadType = DOWNLOAD_TYPES.SELECTION;
          url = Download.makeObjectUrl(info.selectionText);
          suggestedFilename = `${Path.truncateIfLongerThan(
            (currentTab && currentTab.title) || info.selectionText,
            options.truncateLength - 14
          )}.selection.txt`;
        } else if (options.page && info.pageUrl) {
          downloadType = DOWNLOAD_TYPES.PAGE;
          url = info.pageUrl;
          const pageTitle = currentTab && currentTab.title;
          suggestedFilename = pageTitle || info.pageUrl;
        } else {
          return;
        }

        let saveIntoPath;

        if (matchedDir === "route-exclusive") {
          saveIntoPath = ".";
        } else if (matchedDir === "last-used") {
          saveIntoPath = lastUsedPath;
          comment = window.lastDownloadState.info.comment;
          menuIndex = window.lastDownloadState.info.menuIndex;
        } else {
          saveIntoPath = matchedDir;
          lastUsedPath = saveIntoPath;
          const title = Menus.titles[info.menuItemId] || lastUsedPath;

          if (options.enableLastLocation) {
            browser.contextMenus.update(Menus.IDS.LAST_USED, {
              title: BROWSER_FEATURES.accessKeys ? `${title} (&a)` : title,
              enabled: true
            });
          }
        }

        const parsedPath = new Path.Path(saveIntoPath);

        const saveAsShortcut =
          (downloadType === DOWNLOAD_TYPES.MEDIA && options.shortcutMedia) ||
          (downloadType === DOWNLOAD_TYPES.LINK && options.shortcutLink) ||
          (downloadType === DOWNLOAD_TYPES.PAGE && options.shortcutPage);

        if (saveAsShortcut) {
          url = Shortcut.makeShortcut(options.shortcutType, url);

          suggestedFilename = Shortcut.suggestShortcutFilename(
            options.shortcutType,
            downloadType,
            info,
            suggestedFilename,
            options.truncateLength
          );
        }

        if (suggestedFilename) {
          suggestedFilename = Path.sanitizeFilename(
            suggestedFilename,
            options.truncateLength
          );
        }

        // Organise things by flattening the info struct and only keeping needed info
        const opts = {
          currentTab, // Global
          linkText: info.linkText,
          now: new Date(),
          pageUrl: info.pageUrl,
          selectionText: info.selectionText,
          sourceUrl: info.srcUrl || info.url,
          url, // Changes based off context
          suggestedFilename, // wip: rename
          context: downloadType,
          menuIndex,
          comment,
          modifiers: info.modifiers,
          legacyDownloadInfo: info // wip, remove
        };

        // keeps track of state of the final path
        const state = {
          path: parsedPath,
          scratch: {},
          info: opts
        };

        requestedDownloadFlag = true; // Notifications.
        Download.renameAndDownload(state);
      }
    });
  },

  addTabMenus: () => {
    if (!options.tabEnabled) {
      return;
    }

    browser.contextMenus.create({
      id: Menus.IDS.TABSTRIP.SELECTED_TAB,
      title: browser.i18n.getMessage("tabstripMenuSelectedTab"),
      contexts: ["tab"]
    });

    if (BROWSER_FEATURES.multitab) {
      browser.contextMenus.create({
        id: Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
        title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [1]),
        contexts: ["tab"]
      });

      browser.tabs.onHighlighted.addListener(highlightInfo => {
        const length = highlightInfo.tabIds.length;
        browser.contextMenus.update(Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
          title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [
            length
          ]),
          contexts: ["tab"]
        });
      });
    }

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
        case Menus.IDS.TABSTRIP.SELECTED_MULTIPLE_TABS:
          filter = () => true;
          query = Object.assign(query, { highlighted: true });
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
