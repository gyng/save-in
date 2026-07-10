// Context menu construction: parses the paths option into a menu tree
// (`buildTree`, pure) and renders it with browser.contextMenus.create.
// Click handling lives in menu-click.js, tab-strip menus in menu-tabs.js —
// both extend this Menus object via the shared global scope.

const Menus = {
  IDS: {
    TABSTRIP: {
      SELECTED_TAB: "save-in-SI-selected-tab",
      SELECTED_MULTIPLE_TABS: "save-in-SI-selected-multiple-tabs",
      TO_RIGHT: "save-in-SI-to-right",
      TO_RIGHT_MATCH: "save-in-SI-to-right-match",
      OPENED_FROM_TAB: "save-in-SI-opened-from-tab",
    },
    ROUTE_EXCLUSIVE: "save-in-route-exclusive",
    ROOT: "save-in-root",
    LAST_USED: "save-in-last-used",
  },

  // In-memory copy of the last-used menu target; persisted to
  // storage.local (MV3 workers are stateless) and restored by index.js
  state: {
    lastUsedPath: null,
    lastUsedMeta: null, // {comment, menuIndex} of the last used item
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
      title: Menus.setAccesskey(browser.i18n.getMessage("contextMenuRoot"), options.keyRoot),
      contexts,
    });
  },

  addRouteExclusive: (contexts) => {
    browser.contextMenus.create({
      id: Menus.IDS.ROUTE_EXCLUSIVE,
      title: Menus.setAccesskey(browser.i18n.getMessage("contextMenuExclusive"), options.keyRoot),
      contexts,
    });
  },

  addSelectionType: (contexts) => {
    if (contexts.includes("link")) {
      browser.contextMenus.create({
        id: "download-context-media-link",
        title: browser.i18n.getMessage("contextMenuContextMediaOrLink"),
        enabled: false,
        contexts: MEDIA_TYPES.concat("link"),
        parentId: Menus.IDS.ROOT,
      });
    } else {
      browser.contextMenus.create({
        id: "download-context-media",
        title: browser.i18n.getMessage("contextMenuContextMedia"),
        enabled: false,
        contexts: MEDIA_TYPES,
        parentId: Menus.IDS.ROOT,
      });
    }

    if (contexts.includes("selection")) {
      browser.contextMenus.create({
        id: "download-context-selection",
        title: browser.i18n.getMessage("contextMenuContextSelection"),
        enabled: false,
        contexts: ["selection"],
        parentId: Menus.IDS.ROOT,
      });
    }

    if (contexts.includes("page")) {
      browser.contextMenus.create({
        id: "download-context-page",
        title: browser.i18n.getMessage("contextMenuContextPage"),
        enabled: false,
        contexts: ["page"],
        parentId: Menus.IDS.ROOT,
      });
    }
  },

  addOptions: (contexts) => {
    browser.contextMenus.create({
      id: "options",
      title: browser.i18n.getMessage("contextMenuItemOptions"),
      contexts,
      parentId: "save-in-root",
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
      Menus.state.lastUsedPath || browser.i18n.getMessage("contextMenuLastUsed");
    const lastUsedMenuOptions = {
      id: Menus.IDS.LAST_USED,
      title: Menus.setAccesskey(lastUsedTitle, options.keyLastUsed),
      enabled: Menus.state.lastUsedPath ? true : false, // eslint-disable-line
      contexts,
      parentId: Menus.IDS.ROOT,
    };

    // Match the menu icon to the browser theme (#184). Chrome's service
    // worker has no matchMedia (and rejects `icons` anyway — the catch
    // handles it); Firefox's event page has both.
    const darkMode =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const icon = darkMode ? "icons/ic_update_white_24px.svg" : "icons/ic_update_black_24px.svg";

    // Chrome, FF < 57 crash when icons is supplied
    // There is no easy way to detect support, so use a try/catch
    try {
      browser.contextMenus.create(
        Object.assign({}, lastUsedMenuOptions, {
          icons: {
            16: icon,
          },
        }),
      );
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
          .map((val) => val.trim()),
      )
      .reduce((acc, kv) => {
        const key = kv[0];
        return Object.assign(acc, { [key]: kv.slice(1).join(" ") });
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

  // Pure: computes the menu tree for the paths option without touching
  // browser APIs or Menus state. Returns { items, errors } where items
  // are either { kind: "separator", parentId } or
  // { kind: "path", id, title, number, accessKeyOverride, parsedDir,
  //   comment, menuIndex, depth, parentId }.
  buildTree: (pathsArray) => {
    const items = [];
    const errors = [];
    const menuItemCounter = [0]; // key: depth, val: index

    // Stack of open parent ids for nested menus
    let pathsNestingStack = [];
    let lastDepth = 0;

    pathsArray.forEach((dir, i) => {
      if (dir === SPECIAL_DIRS.SEPARATOR) {
        items.push({ kind: "separator", parentId: Menus.IDS.ROOT });
        return;
      }

      const { comment, depth, meta, validation, parsedDir } = Menus.parsePath(dir);

      if (!validation.valid) {
        errors.push({
          message: validation.message,
          error: `${dir}`,
        });
        return;
      }

      // An empty alias `(alias: )` must not produce an empty menu title
      const title = meta.alias ? meta.alias : parsedDir;

      // splice the counter to fit current depth, resetting the farther depths
      menuItemCounter.splice(depth + 1);
      if (menuItemCounter[depth] != null) {
        menuItemCounter[depth] += 1;
      } else {
        menuItemCounter[depth] = 1;
      }
      const id = `save-in-${i}`;

      let parentId;
      if (depth === 0) {
        parentId = Menus.IDS.ROOT;
      } else if (depth > pathsNestingStack.length) {
        parentId = pathsNestingStack[pathsNestingStack.length - 1];
      } else {
        parentId = pathsNestingStack[depth - 1];
      }

      if (parsedDir === SPECIAL_DIRS.SEPARATOR) {
        items.push({ kind: "separator", parentId });
        return;
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

      items.push({
        kind: "path",
        id,
        title,
        number: menuItemCounter[depth],
        accessKeyOverride: meta.key,
        parsedDir,
        comment: `${i}${comment.replaceAll("-", "_")}`,
        menuIndex: menuItemCounter.join("."),
        depth,
        parentId,
      });
    });

    return { items, errors };
  },

  addPaths: (pathsArray, contexts) => {
    Menus.pathMappings = {};

    const { items, errors } = Menus.buildTree(pathsArray);

    errors.forEach((error) => {
      window.optionErrors.paths.push(error);
    });

    items.forEach((item) => {
      if (item.kind === "separator") {
        Menus.makeSeparator(contexts, item.parentId);
        return;
      }

      Menus.pathMappings[item.id] = {
        parsedDir: item.parsedDir,
        comment: item.comment,
        menuIndex: item.menuIndex,
        title: item.title,
        depth: item.depth,
      };
      Menus.titles[item.id] = item.title;

      browser.contextMenus.create({
        id: item.id,
        title: options.enableNumberedItems
          ? Menus.setAccesskey(item.title, item.number, item.accessKeyOverride)
          : item.title,
        contexts,
        parentId: item.parentId,
      });
    });
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Menus;
}
