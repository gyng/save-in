// @ts-check

/** @type {null | string} */
let lastUsedPath = null; // global variable

const IDS = {
  TABSTRIP: {
    SELECTED_TAB: "save-in-_-_-SI-selected-tab",
    SELECTED_MULTIPLE_TABS: "save-in-_-_-SI-selected-multiple-tabs",
    TO_RIGHT: "save-in-_-_-SI-to-right",
    TO_RIGHT_MATCH: "save-in-_-_-SI-to-right-match",
    OPENED_FROM_TAB: "save-in-_-_-SI-opened-from-tab",
  },
  ROOT: "save-in-_-_-root",
  LAST_USED: "save-in-_-_-last-used",
};

const Menus = {
  IDS,

  /** @type {Record<string | number, string>} */
  titles: {},

  makeSeparator: (() => {
    let separatorCounter = 0;

    const makeSeparatorInner = (
      /** @type {browser.contextMenus._ContextType[]} */ contexts,
      parentId = IDS.ROOT
    ) => {
      browser.contextMenus.create({
        id: `separator-${separatorCounter}`,
        type: "separator",
        contexts,
        parentId,
      });
      separatorCounter += 1;
    };

    return makeSeparatorInner;
  })(),

  setAccesskey: (
    /** @type {string} */ str,
    /** @type {string | number} */ key
  ) => {
    if (!BROWSER_FEATURES.accessKeys) {
      return str;
    }

    if (str.includes(key.toString())) {
      return str.replace(key.toString(), `&${key}`);
    } else {
      return `${str} (&${key})`;
    }
  },

  addRoot: (/** @type {browser.contextMenus._ContextType[]} */ contexts) => {
    browser.contextMenus.create({
      id: IDS.ROOT,
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuRoot"),
        options.keyRoot
      ),
      contexts,
    });
  },

  addRouteExclusive: (
    /** @type {browser.contextMenus._ContextType[]} */ contexts
  ) => {
    browser.contextMenus.create({
      id: "save-in-_-_-route-exclusive",
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuExclusive"),
        options.keyRoot
      ),
      contexts,
    });
  },

  addSelectionType: (
    /** @type {browser.contextMenus._ContextType[]} */ contexts
  ) => {
    if (contexts.includes("link")) {
      browser.contextMenus.create({
        id: "download-context-media-link",
        title: browser.i18n.getMessage("contextMenuContextMediaOrLink"),
        enabled: false,
        // @ts-ignore
        contexts: MEDIA_TYPES.concat("link"),
        parentId: IDS.ROOT,
      });
    } else {
      browser.contextMenus.create({
        id: "download-context-media",
        title: browser.i18n.getMessage("contextMenuContextMedia"),
        enabled: false,
        // @ts-ignore
        contexts: MEDIA_TYPES,
        parentId: IDS.ROOT,
      });
    }

    if (contexts.includes("selection")) {
      browser.contextMenus.create({
        id: "download-context-selection",
        title: browser.i18n.getMessage("contextMenuContextSelection"),
        enabled: false,
        contexts: ["selection"],
        parentId: IDS.ROOT,
      });
    }

    if (contexts.includes("page")) {
      browser.contextMenus.create({
        id: "download-context-page",
        title: browser.i18n.getMessage("contextMenuContextPage"),
        enabled: false,
        contexts: ["page"],
        parentId: IDS.ROOT,
      });
    }
  },

  addOptions: (/** @type {browser.contextMenus._ContextType[]} */ contexts) => {
    browser.contextMenus.create({
      id: "options",
      title: browser.i18n.getMessage("contextMenuItemOptions"),
      contexts,
      parentId: "save-in-_-_-root",
    });

    browser.contextMenus.onClicked.addListener((info) => {
      if (info.menuItemId === "options") {
        browser.runtime.openOptionsPage();
      }
    });
  },

  addShowDefaultFolder: (
    /** @type {browser.contextMenus._ContextType[]} */ contexts
  ) => {
    browser.contextMenus.create({
      id: "show-default-folder",
      title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
      contexts,
      parentId: IDS.ROOT,
    });

    browser.contextMenus.onClicked.addListener((info) => {
      if (info.menuItemId === "show-default-folder") {
        browser.downloads.showDefaultFolder();
      }
    });
  },

  addLastUsed: (
    /** @type {browser.contextMenus._ContextType[]} */ contexts
  ) => {
    const lastUsedTitle =
      lastUsedPath || browser.i18n.getMessage("contextMenuLastUsed");
    const lastUsedMenuOptions = {
      id: IDS.LAST_USED,
      title: Menus.setAccesskey(lastUsedTitle, options.keyLastUsed),
      enabled: lastUsedPath ? true : false, // eslint-disable-line
      contexts,
      parentId: IDS.ROOT,
    };

    // Chrome, FF < 57 crash when icons is supplied
    // There is no easy way to detect support, so use a try/catch
    try {
      browser.contextMenus.create(
        Object.assign({}, lastUsedMenuOptions, {
          icons: {
            16: "icons/ic_update_black_24px.svg",
          },
        })
      );
    } catch (e) {
      browser.contextMenus.create(lastUsedMenuOptions);
    }
  },

  /** @return {{ alias?: string }} */
  parseMeta: (/** @type {string} */ comment) => {
    const matches = comment.match(/\(.+?:.+?\)+/g);

    if (!matches) {
      return {};
    }

    return matches
      .map((pair) =>
        pair
          .replace(/(^\(|\)$)/g, "")
          .split(":")
          .map((val) => val.trim())
      )
      .reduce((acc, kv) => {
        const key = kv[0];
        return Object.assign(acc, { [key]: kv.slice(1).join(" ") });
      }, {});
  },

  parsePath: (/** @type {string} */ dir) => {
    const tokens = dir.split("//").map((tok) => tok.trim());
    const depthMatch = tokens[0].match(/^(>+)?(.+)/);
    // @ts-ignore
    const arrows = depthMatch[1] || "";
    const depth = arrows.length;
    // @ts-ignore
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
      validation,
    };
  },

  addPaths: (
    /** @type {any[]} */ pathsArray,
    /** @type {browser.contextMenus._ContextType[]} */ contexts
  ) => {
    /** @type {Record<number, number>} */
    const menuItemCounter = { 0: 0 };

    // Create a stack for nested menus
    /** @type {string[]} */
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
            error: `${dir}`,
          });

          return;
        }

        const title = meta.alias != null ? meta.alias : parsedDir;

        if (menuItemCounter[depth] != null) {
          menuItemCounter[depth] += 1;
        } else {
          menuItemCounter[depth] = 1;
        }
        const id = `save-in-${menuItemCounter[depth]}-${`${i}${comment.replace(
          "-",
          "_"
        )}`}-${parsedDir}`;

        let parentId;
        if (depth === 0) {
          parentId = IDS.ROOT;
        } else if (depth > pathsNestingStack.length) {
          parentId = pathsNestingStack[pathsNestingStack.length - 1];
        } else {
          parentId = pathsNestingStack[depth - 1];
        }

        if (parsedDir === SPECIAL_DIRS.SEPARATOR) {
          Menus.makeSeparator(contexts, parentId);
        } else {
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
            parentId,
          });
        }
      }
    });
  },

  // TODO: refactor this to handle only paths, add tests
  addDownloadListener: () => {
    browser.contextMenus.onClicked.addListener((info) => {
      // @ts-ignore
      if (Object.values(IDS.TABSTRIP).includes(info.menuItemId)) {
        return;
      }

      // @ts-ignore
      const matchSave = info.menuItemId.match(/save-in-(\d|_)+-(.*?)-(.*)/);

      if (matchSave && matchSave.length === 4) {
        let menuIndex = matchSave[1];
        let comment = matchSave[2];
        const matchedDir = matchSave[3];

        let url;
        let suggestedFilename = null;
        let downloadType = DOWNLOAD_TYPES.UNKNOWN;

        const hasLink = options.links && info.linkUrl;

        // @ts-ignore
        if (MEDIA_TYPES.includes(info.mediaType)) {
          downloadType = DOWNLOAD_TYPES.MEDIA;
          url = info.srcUrl;

          if (hasLink) {
            if (options.preferLinks) {
              downloadType = DOWNLOAD_TYPES.LINK;
              url = info.linkUrl;

              if (options.notifyOnLinkPreferred) {
                CustomNotification.createExtensionNotification(
                  browser.i18n.getMessage("notificationLinkPreferred"),
                  // @ts-ignore
                  url
                );
              }
            }

            if (options.preferLinksFilterEnabled && options.preferLinksFilter) {
              let overrideUrls = false;
              try {
                (options.preferLinksFilter || "")
                  .split("\n")
                  .map((s) => s.trim())
                  .map((s) => new RegExp(s))
                  .forEach((re) => {
                    // @ts-ignore
                    if (info.pageUrl.match(re) != null) {
                      overrideUrls = true;
                    }
                  });
              } catch (err) {
                CustomNotification.createExtensionNotification(
                  browser.i18n.getMessage("notificationBadPreferLinksPattern"),
                  // @ts-ignore
                  err
                );
              }

              if (overrideUrls) {
                downloadType = DOWNLOAD_TYPES.LINK;
                url = info.linkUrl;

                if (options.notifyOnLinkPreferred) {
                  CustomNotification.createExtensionNotification(
                    browser.i18n.getMessage("notificationLinkPreferred"),
                    // @ts-ignore
                    url
                  );
                }
              }
            }
          }
        } else if (hasLink) {
          downloadType = DOWNLOAD_TYPES.LINK;
          url = info.linkUrl;
        } else if (options.selection && info.selectionText) {
          downloadType = DOWNLOAD_TYPES.SELECTION;
          url = Download.makeObjectUrl(info.selectionText);
          suggestedFilename = `${Path.truncateIfLongerThan(
            (currentTab && currentTab.title) || info.selectionText,
            // @ts-ignore
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
          const title =
            Menus.titles[info.menuItemId] || lastUsedPath || undefined;

          if (options.enableLastLocation) {
            browser.contextMenus.update(IDS.LAST_USED, {
              title: BROWSER_FEATURES.accessKeys ? `${title} (&a)` : title,
              enabled: true,
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
          // @ts-ignore
          sourceUrl: info.srcUrl || info.url,
          url, // Changes based off context
          suggestedFilename, // wip: rename
          context: downloadType,
          menuIndex,
          comment,
          modifiers: info.modifiers,
        };

        // keeps track of state of the final path
        const state = {
          path: parsedPath,
          scratch: {},
          info: opts,
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
      id: IDS.TABSTRIP.SELECTED_TAB,
      title: browser.i18n.getMessage("tabstripMenuSelectedTab"),
      contexts: ["tab"],
    });

    if (BROWSER_FEATURES.multitab) {
      browser.contextMenus.create({
        id: IDS.TABSTRIP.SELECTED_MULTIPLE_TABS,
        title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [1]),
        contexts: ["tab"],
      });

      browser.tabs.onHighlighted.addListener((highlightInfo) => {
        const length = highlightInfo.tabIds.length;
        browser.contextMenus.update(IDS.TABSTRIP.SELECTED_MULTIPLE_TABS, {
          title: browser.i18n.getMessage("tabstripMenuMultipleSelectedTab", [
            length,
          ]),
          contexts: ["tab"],
        });
      });
    }

    browser.contextMenus.create({
      id: IDS.TABSTRIP.OPENED_FROM_TAB,
      title: browser.i18n.getMessage("tabstripMenuSaveChildrenTabs"),
      contexts: ["tab"],
    });

    browser.contextMenus.create({
      id: IDS.TABSTRIP.TO_RIGHT,
      title: browser.i18n.getMessage("tabstripMenuSaveRightTabs"),
      contexts: ["tab"],
    });

    browser.contextMenus.create({
      id: IDS.TABSTRIP.TO_RIGHT_MATCH,
      title: browser.i18n.getMessage("tabstripMenuSaveRightTabsMatched"),
      contexts: ["tab"],
    });

    const ids = Object.values(IDS.TABSTRIP);

    browser.contextMenus.onClicked.addListener((info, fromTab) => {
      // @ts-ignore
      if (!ids.includes(info.menuItemId)) {
        return;
      }

      let filter = () => false;

      /** @type {browser.tabs._QueryQueryInfo} */
      let query = {
        pinned: false,
        // @ts-ignore
        windowId: fromTab.windowId,
        windowType: "normal",
      };

      switch (info.menuItemId) {
        case IDS.TABSTRIP.SELECTED_TAB:
          // @ts-ignore
          filter = (t) => t.id === fromTab.id;
          break;
        case IDS.TABSTRIP.SELECTED_MULTIPLE_TABS:
          filter = () => true;
          query = Object.assign(query, { highlighted: true });
          break;
        case IDS.TABSTRIP.TO_RIGHT:
        case IDS.TABSTRIP.TO_RIGHT_MATCH:
          // @ts-ignore
          filter = (t) => t.index >= fromTab.index;
          break;
        case IDS.TABSTRIP.OPENED_FROM_TAB:
          filter = () => true;
          // @ts-ignore
          query = Object.assign(query, { openerTabId: fromTab.id });
          break;
        default:
          break;
      }

      browser.tabs
        .query(query)
        // @ts-ignore
        .then((tabs) => tabs.filter((t) => !t.url.match(/^(about|chrome):/)))
        .then((tabs) => tabs.filter(filter))
        .then((tabs) => {
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
              /**
               * @type State
               */
              const state = {
                path: new Path.Path("."),
                scratch: {},
                info: opts,
                needRouteMatch: info.menuItemId === IDS.TABSTRIP.TO_RIGHT_MATCH,
              };

              Download.renameAndDownload(state);

              // TODO: Store tabs marked for saving and close only on successful save
              if (options.closeTabOnSave) {
                window.setTimeout(() => {
                  // @ts-ignore
                  browser.tabs.remove(t.id);
                }, timeoutInterval);
              }
            }, timeoutInterval * i);
          });
        });
    });
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
