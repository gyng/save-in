let lastUsedPath = null; // global variable
let preferLinksCache = [];

const Menus = {
  IDS: {
    ROUTE_EXCLUSIVE: "save-in-route-exclusive",
    ROOT: "save-in-root",
    LAST_USED: "save-in-last-used",
  },

  titles: {},
  pathMappings: {}, // key: ID, val: actual path

  makeSeparator: (() => {
    let separatorCounter = 0;

    const makeSeparatorInner = (contexts, parentId = Menus.IDS.ROOT) => {
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

  setAccesskey: (str, key, override) => {
    if (!BROWSER_FEATURES.accessKeys) {
      return str;
    }

    const keyUsed = override != null ? override : key;

    if (str.includes(keyUsed)) {
      return str.replace(keyUsed, `&${keyUsed}`);
    } else {
      return `${str} (&${keyUsed})`;
    }
  },

  addRoot: (contexts) => {
    browser.contextMenus.create({
      id: Menus.IDS.ROOT,
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuRoot"),
        options.keyRoot
      ),
      contexts,
    });
  },

  addRouteExclusive: (contexts) => {
    browser.contextMenus.create({
      id: Menus.IDS.ROUTE_EXCLUSIVE,
      title: Menus.setAccesskey(
        browser.i18n.getMessage("contextMenuExclusive"),
        options.keyRoot
      ),
      contexts,
    });
  },

  addDisabledItem: (id, titleKey, contexts) => {
    browser.contextMenus.create({
      id,
      title: browser.i18n.getMessage(titleKey),
      enabled: false,
      contexts,
      parentId: Menus.IDS.ROOT,
    });
  },

  addSelectionType: (contexts) => {
    if (contexts.includes("link")) {
      Menus.addDisabledItem(
        "download-context-media-link",
        "contextMenuContextMediaOrLink",
        [...MEDIA_TYPES, "link"]
      );
    } else {
      Menus.addDisabledItem(
        "download-context-media",
        "contextMenuContextMedia",
        MEDIA_TYPES
      );
    }

    if (contexts.includes("selection")) {
      Menus.addDisabledItem(
        "download-context-selection",
        "contextMenuContextSelection",
        ["selection"]
      );
    }

    if (contexts.includes("page")) {
      Menus.addDisabledItem("download-context-page", "contextMenuContextPage", [
        "page",
      ]);
    }
  },

  addOptions: (contexts) => {
    browser.contextMenus.create({
      id: "options",
      title: browser.i18n.getMessage("contextMenuItemOptions"),
      contexts,
      parentId: Menus.IDS.ROOT,
    });
  },

  addShowDefaultFolder: (contexts) => {
    browser.contextMenus.create({
      id: "show-default-folder",
      title: browser.i18n.getMessage("contextMenuShowDefaultFolder"),
      contexts,
      parentId: Menus.IDS.ROOT,
    });
  },

  addLastUsed: (contexts) => {
    const lastUsedTitle =
      lastUsedPath ?? browser.i18n.getMessage("contextMenuLastUsed");
    const lastUsedMenuOptions = {
      id: Menus.IDS.LAST_USED,
      title: Menus.setAccesskey(lastUsedTitle, options.keyLastUsed),
      enabled: !!lastUsedPath, // eslint-disable-line
      contexts,
      parentId: Menus.IDS.ROOT,
    };

    // Chrome, FF < 57 crash when icons is supplied
    // There is no easy way to detect support, so use a try/catch
    try {
      browser.contextMenus.create({
        ...lastUsedMenuOptions,
        icons: { 16: "icons/ic_update_black_24px.svg" },
      });
    } catch (e) {
      browser.contextMenus.create(lastUsedMenuOptions);
    }
  },

  parseMeta: (comment) => {
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
        return { ...acc, [key]: kv.slice(1).join(" ") };
      }, {});
  },

  parsePath: (dir) => {
    const tokens = dir.split("//").map((tok) => tok.trim());
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
      validation,
    };
  },

  addPaths: (pathsArray, contexts) => {
    const menuItemCounter = [0]; // key: depth, val: index
    Menus.pathMappings = {};

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
          self.optionErrors.paths.push({
            message: validation.message,
            error: `${dir}`,
          });

          return;
        }

        const title = meta.alias != null ? meta.alias : parsedDir;

        // splice the counter to fit current depth, resetting the farther depths
        menuItemCounter.splice(depth + 1);
        if (menuItemCounter[depth] != null) {
          menuItemCounter[depth] += 1;
        } else {
          menuItemCounter[depth] = 1;
        }
        const id = `save-in-${i}`;
        Menus.pathMappings[id] = {
          parsedDir,
          comment: `${i}${comment.replace("-", "_")}`,
          menuIndex: menuItemCounter.join("."),
          title,
          depth,
        };

        let parentId;
        if (depth === 0) {
          parentId = Menus.IDS.ROOT;
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
              ? Menus.setAccesskey(title, menuItemCounter[depth], meta.key)
              : title,
            contexts,
            parentId,
          });
        }
      }
    });
  },

  buildFilterCache: () => {
    try {
      preferLinksCache = (options.preferLinksFilter || "")
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s)
        .map((s) => new RegExp(s));
    } catch (e) {
      preferLinksCache = [];
    }
  },

  // Unified context menu click handler
  addDownloadListener: () => {
    browser.contextMenus.onClicked.addListener((info, fromTab) => {
      // Handle simple menu items
      if (info.menuItemId === "options") {
        browser.runtime.openOptionsPage();
        return;
      }
      if (info.menuItemId === "show-default-folder") {
        browser.downloads.showDefaultFolder();
        return;
      }

      const menuInfo = Menus.pathMappings[info.menuItemId];

      if (
        menuInfo ||
        [Menus.IDS.ROUTE_EXCLUSIVE, Menus.IDS.LAST_USED].includes(
          info.menuItemId
        )
      ) {
        let menuIndex = menuInfo && menuInfo.menuIndex;
        let comment = menuInfo && menuInfo.comment;

        let url;
        let suggestedFilename = null;
        let downloadType = DOWNLOAD_TYPES.UNKNOWN;

        const hasLink = options.links && info.linkUrl;

        if (MEDIA_TYPES.includes(info.mediaType)) {
          downloadType = DOWNLOAD_TYPES.MEDIA;
          url = info.srcUrl;

          if (hasLink) {
            if (options.preferLinks) {
              downloadType = DOWNLOAD_TYPES.LINK;
              url = info.linkUrl;

              if (options.notifyOnLinkPreferred) {
                Notification.createExtensionNotification(
                  browser.i18n.getMessage("notificationLinkPreferred"),
                  url
                );
              }
            }

            if (options.preferLinksFilterEnabled && preferLinksCache.length) {
              const overrideUrls = preferLinksCache.some((re) =>
                info.pageUrl.match(re)
              );

              if (overrideUrls) {
                downloadType = DOWNLOAD_TYPES.LINK;
                url = info.linkUrl;

                if (options.notifyOnLinkPreferred) {
                  Notification.createExtensionNotification(
                    browser.i18n.getMessage("notificationLinkPreferred"),
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
            currentTab?.title ?? info.selectionText,
            options.truncateLength - 14
          )}.selection.txt`;
        } else if (options.page && info.pageUrl) {
          downloadType = DOWNLOAD_TYPES.PAGE;
          url = info.pageUrl;
          const pageTitle = currentTab?.title;
          suggestedFilename = pageTitle ?? info.pageUrl;
        } else {
          return;
        }

        let saveIntoPath;

        if (info.menuItemId === Menus.IDS.ROUTE_EXCLUSIVE) {
          saveIntoPath = ".";
        } else if (info.menuItemId === Menus.IDS.LAST_USED) {
          saveIntoPath = lastUsedPath;
          comment = self.lastDownloadState.info.comment;
          menuIndex = self.lastDownloadState.info.menuIndex;
        } else {
          saveIntoPath = menuInfo.parsedDir;
          lastUsedPath = saveIntoPath;
          const title = menuInfo.title || lastUsedPath;

          if (options.enableLastLocation) {
            browser.contextMenus.update(Menus.IDS.LAST_USED, {
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
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
