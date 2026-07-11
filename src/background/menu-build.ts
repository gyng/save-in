import { webExtensionApi } from "../platform/web-extension-api.ts";

// Context menu construction: parses the paths option into a menu tree
// (`buildTree`, pure) and renders it with webExtensionApi.contextMenus.create.
// Click handling lives in menu-click.ts and tab-strip menus in menu-tabs.ts.

import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { options } from "../config/options-data.ts";
import { MEDIA_TYPES, SPECIAL_DIRS } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";

type MenuContext = `${chrome.contextMenus.ContextType}`;
const asMenuContexts = (contexts: string[]) => contexts as MenuContext[];
type LastUsedMeta = { comment: string; menuIndex: string };
type StoredLastUsed = {
  lastUsedPath?: string | null;
  lastUsedMeta?: LastUsedMeta | null;
} | null;
type MenuMeta = Record<string, string>;
type ParsedPath = {
  raw: string;
  comment: string;
  depth: number;
  meta: MenuMeta;
  parsedDir: string;
  validation: { valid: boolean; message?: string };
};
type MenuPathMapping = {
  parsedDir: string;
  // Kept permissive until menu-click's optional routing fields are strict-typed.
  comment: any;
  menuIndex: any;
  title: string;
  depth: number;
};
type MenuSeparator = { kind: "separator"; parentId: string };
type MenuPathItem = {
  kind: "path";
  id: string;
  title: string;
  number: number;
  accessKeyOverride?: string;
  parsedDir: string;
  comment: string;
  menuIndex: string;
  depth: number;
  parentId: string;
  raw: string;
};
type MenuTreeItem = MenuSeparator | MenuPathItem;
type MenuTreeError = OptionError & { parentId?: string };
type MenuTree = { items: MenuTreeItem[]; errors: MenuTreeError[] };

export const MENU_IDS = {
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
} as const;

// This is genuine mutable application state shared by menu construction and
// click handling. Functions stay as module exports instead of being attached
// to this record.
export const menuState: {
  lastUsedPath: string | null;
  lastUsedMeta: LastUsedMeta | null;
  titles: Record<string, string>;
  pathMappings: Record<string | number, MenuPathMapping>;
} = {
  lastUsedPath: null,
  lastUsedMeta: null,
  titles: {} as Record<string, string>,
  pathMappings: {} as Record<string | number, MenuPathMapping>,
};

// Single owner of the last-used-path state: menu-click mutates it here,
// background-main.ts restores it, menu-build renders it. MV3 service workers are
// stateless, so it is mirrored to storage.local to survive restarts.
export const setLastUsed = (path: string, meta: LastUsedMeta) => {
  menuState.lastUsedPath = path;
  menuState.lastUsedMeta = meta;
  webExtensionApi.storage.local.set({ lastUsedPath: path, lastUsedMeta: meta });
};

export const restoreLastUsed = (stored: StoredLastUsed) => {
  menuState.lastUsedPath = (stored && stored.lastUsedPath) || null;
  menuState.lastUsedMeta = (stored && stored.lastUsedMeta) || null;
};

export const makeSeparator = (() => {
  let separatorCounter = 0;

  const makeSeparatorInner = (contexts: string[], parentId: string = MENU_IDS.ROOT): void => {
    webExtensionApi.contextMenus.create({
      id: `separator-${separatorCounter}`,
      type: "separator",
      contexts: asMenuContexts(contexts),
      parentId,
    });
    separatorCounter += 1;
  };

  return makeSeparatorInner;
})();

export const setAccesskey = (str: string, key: string | number, override?: string) => {
  if (!WEB_EXTENSION_CAPABILITIES.accessKeys) {
    return str;
  }

  const keyUsed = override != null ? override : key;

  const accessKey = String(keyUsed);
  if (str.includes(accessKey)) {
    return str.replace(accessKey, `&${accessKey}`);
  } else {
    return `${str} (&${accessKey})`;
  }
};

export const addRoot = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROOT,
    title: setAccesskey(webExtensionApi.i18n.getMessage("contextMenuRoot"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addRouteExclusive = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROUTE_EXCLUSIVE,
    title: setAccesskey(webExtensionApi.i18n.getMessage("contextMenuExclusive"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addSelectionType = (contexts: string[]) => {
  if (contexts.includes("link")) {
    webExtensionApi.contextMenus.create({
      id: "download-context-media-link",
      title: webExtensionApi.i18n.getMessage("contextMenuContextMediaOrLink"),
      enabled: false,
      contexts: MEDIA_TYPES.concat("link") as any,
      parentId: MENU_IDS.ROOT,
    });
  } else {
    webExtensionApi.contextMenus.create({
      id: "download-context-media",
      title: webExtensionApi.i18n.getMessage("contextMenuContextMedia"),
      enabled: false,
      contexts: MEDIA_TYPES as any,
      parentId: MENU_IDS.ROOT,
    });
  }

  if (contexts.includes("selection")) {
    webExtensionApi.contextMenus.create({
      id: "download-context-selection",
      title: webExtensionApi.i18n.getMessage("contextMenuContextSelection"),
      enabled: false,
      contexts: ["selection"],
      parentId: MENU_IDS.ROOT,
    });
  }

  if (contexts.includes("page")) {
    webExtensionApi.contextMenus.create({
      id: "download-context-page",
      title: webExtensionApi.i18n.getMessage("contextMenuContextPage"),
      enabled: false,
      contexts: ["page"],
      parentId: MENU_IDS.ROOT,
    });
  }
};

export const addOptions = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: "options",
    title: webExtensionApi.i18n.getMessage("contextMenuItemOptions"),
    contexts: asMenuContexts(contexts),
    parentId: "save-in-root",
  });
};

export const addShowDefaultFolder = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: "show-default-folder",
    title: webExtensionApi.i18n.getMessage("contextMenuShowDefaultFolder"),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addLastUsed = (contexts: string[]) => {
  const lastUsedTitle =
    menuState.lastUsedPath || webExtensionApi.i18n.getMessage("contextMenuLastUsed");
  const lastUsedMenuOptions = {
    id: MENU_IDS.LAST_USED,
    title: setAccesskey(lastUsedTitle, options.keyLastUsed),
    enabled: Boolean(menuState.lastUsedPath),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
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
    webExtensionApi.contextMenus.create(
      Object.assign({}, lastUsedMenuOptions, {
        icons: {
          16: icon,
        },
      }),
    );
  } catch (e) {
    webExtensionApi.contextMenus.create(lastUsedMenuOptions);
  }
};

export const parseMeta = (comment: string): MenuMeta => {
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
    .reduce<MenuMeta>((acc, kv) => {
      const key = kv[0];
      return Object.assign(acc, { [key]: kv.slice(1).join(" ") });
    }, {});
};

export const parsePath = (dir: string): ParsedPath => {
  const tokens = dir.split("//").map((tok) => tok.trim());
  const depthMatch = tokens[0].match(/^(>+)?(.+)/)!;
  const arrows = depthMatch[1] || "";
  const depth = arrows.length;
  const parsedDir = depthMatch[2].trim();
  const validation = new Path(parsedDir).validate();
  const comment = (tokens[1] || "").trim();
  const meta = parseMeta(comment);

  return {
    raw: dir,
    comment,
    depth,
    meta,
    parsedDir,
    validation,
  };
};

// Pure: computes the menu tree for the paths option without touching browser
// APIs or menu state.
export const buildTree = (pathsArray: string[]): MenuTree => {
  const items: MenuTreeItem[] = [];
  const errors: MenuTreeError[] = [];
  const menuItemCounter = [0]; // key: depth, val: index

  // Stack of open parent ids for nested menus
  let pathsNestingStack: string[] = [];
  let lastDepth = 0;

  pathsArray.forEach((dir, i) => {
    if (dir === SPECIAL_DIRS.SEPARATOR) {
      items.push({ kind: "separator", parentId: MENU_IDS.ROOT });
      return;
    }

    const { comment, depth, meta, validation, parsedDir } = parsePath(dir);

    if (!validation.valid) {
      // Attribute the error to the submenu it would have belonged to, so the
      // preview can show it in place (not orphaned at the root).
      let errorParentId;
      if (depth === 0) {
        errorParentId = MENU_IDS.ROOT;
      } else if (depth > pathsNestingStack.length) {
        errorParentId = pathsNestingStack[pathsNestingStack.length - 1];
      } else {
        errorParentId = pathsNestingStack[depth - 1];
      }
      errors.push({
        message: validation.message!,
        error: `${dir}`,
        parentId: errorParentId,
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

    let parentId: string;
    if (depth === 0) {
      parentId = MENU_IDS.ROOT;
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
      // The original textarea line, so the preview can jump back to it
      raw: dir,
    });
  });

  return { items, errors };
};

export const addPaths = (pathsArray: string[], contexts: string[]) => {
  for (const id of Object.keys(menuState.pathMappings)) {
    delete menuState.pathMappings[id];
  }

  const { items, errors } = buildTree(pathsArray);

  errors.forEach((error) => {
    window.optionErrors.paths.push(error);
  });

  items.forEach((item) => {
    if (item.kind === "separator") {
      makeSeparator(contexts, item.parentId);
      return;
    }

    menuState.pathMappings[item.id] = {
      parsedDir: item.parsedDir,
      comment: item.comment,
      menuIndex: item.menuIndex,
      title: item.title,
      depth: item.depth,
    };
    menuState.titles[item.id] = item.title;

    webExtensionApi.contextMenus.create({
      id: item.id,
      title: options.enableNumberedItems
        ? setAccesskey(item.title, item.number, item.accessKeyOverride)
        : item.title,
      contexts: asMenuContexts(contexts),
      parentId: item.parentId,
    });
  });
};
