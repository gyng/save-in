import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

// Context menu construction: parses the paths option into a menu tree
// (`buildTree`, pure) and renders it with webExtensionApi.contextMenus.create.
// Click handling lives in menu-click.ts and tab-strip menus in menu-tabs.ts.

import { WEB_EXTENSION_CAPABILITIES } from "../platform/chrome-detector.ts";
import { options } from "../config/options-data.ts";
import { LAST_USED_META_STORAGE_KEY, LAST_USED_PATH_STORAGE_KEY } from "../shared/storage-keys.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { backgroundRuntime } from "./runtime.ts";
import { buildTree } from "../menus/menu-tree.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";

export { buildTree, parseMeta, parsePath } from "../menus/menu-tree.ts";
export { MENU_IDS } from "../menus/menu-ids.ts";

type MenuContexts = NonNullable<
  Parameters<typeof webExtensionApi.contextMenus.create>[0]["contexts"]
>;
type MenuContext = MenuContexts[number];
const asMenuContexts = (contexts: readonly string[]): MenuContexts => {
  const normalized = contexts.filter((context): context is MenuContext => context.length > 0);
  const [first = "all" as MenuContext, ...rest] = normalized;
  return [first, ...rest] as MenuContexts;
};
type LastUsedMeta = { comment?: string; menuIndex?: string };
type StoredLastUsed = {
  lastUsedPath?: string | null;
  lastUsedMeta?: LastUsedMeta | null;
} | null;
type MenuPathMapping = {
  parsedDir: string;
  comment: string;
  menuIndex: string;
  title: string;
};

// This is genuine mutable application state shared by menu construction and
// click handling. Functions stay as module exports instead of being attached
// to this record.
export const menuState: {
  lastUsedPath: string | null;
  lastUsedMeta: LastUsedMeta | null;
  pathMappings: Record<string | number, MenuPathMapping>;
} = {
  lastUsedPath: null,
  lastUsedMeta: null,
  pathMappings: {} as Record<string | number, MenuPathMapping>,
};

// Single owner of the last-used-path state: menu-click mutates it here,
// background-main.ts restores it, menu-build renders it. MV3 service workers are
// stateless, so it is mirrored to storage.local to survive restarts.
export const setLastUsed = (path: string, meta: LastUsedMeta, privateContext = false) => {
  if (privateContext) return Promise.resolve();
  menuState.lastUsedPath = path;
  menuState.lastUsedMeta = meta;
  return webExtensionApi.storage.local
    .set({ [LAST_USED_PATH_STORAGE_KEY]: path, [LAST_USED_META_STORAGE_KEY]: meta })
    .catch(() => {});
};

export const restoreLastUsed = (stored: StoredLastUsed) => {
  const path = stored?.lastUsedPath;
  const meta = stored?.lastUsedMeta;
  menuState.lastUsedPath =
    typeof path === "string" && path && new Path(path).validate().valid ? path : null;
  menuState.lastUsedMeta =
    menuState.lastUsedPath &&
    meta != null &&
    (meta.comment === undefined || typeof meta.comment === "string") &&
    (meta.menuIndex === undefined || typeof meta.menuIndex === "string")
      ? meta
      : null;
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
    title: setAccesskey(getMessage("contextMenuRoot"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addRouteExclusive = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROUTE_EXCLUSIVE,
    title: setAccesskey(getMessage("contextMenuExclusive"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addSelectionType = (contexts: readonly string[]) => {
  if (contexts.includes("link")) {
    webExtensionApi.contextMenus.create({
      id: MENU_IDS.CONTEXT.MEDIA_LINK,
      title: getMessage("contextMenuContextMediaOrLink"),
      enabled: false,
      contexts: asMenuContexts([...MEDIA_TYPES, "link"]),
      parentId: MENU_IDS.ROOT,
    });
  } else {
    webExtensionApi.contextMenus.create({
      id: MENU_IDS.CONTEXT.MEDIA,
      title: getMessage("contextMenuContextMedia"),
      enabled: false,
      contexts: asMenuContexts(MEDIA_TYPES),
      parentId: MENU_IDS.ROOT,
    });
  }

  if (contexts.includes("selection")) {
    webExtensionApi.contextMenus.create({
      id: MENU_IDS.CONTEXT.SELECTION,
      title: getMessage("contextMenuContextSelection"),
      enabled: false,
      contexts: ["selection"],
      parentId: MENU_IDS.ROOT,
    });
  }

  if (contexts.includes("page")) {
    webExtensionApi.contextMenus.create({
      id: MENU_IDS.CONTEXT.PAGE,
      title: getMessage("contextMenuContextPage"),
      enabled: false,
      contexts: ["page"],
      parentId: MENU_IDS.ROOT,
    });
  }
};

export const addOptions = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.OPTIONS,
    title: getMessage("contextMenuItemOptions"),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addSourcePanel = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TOGGLE_SOURCE_PANEL,
    title: getMessage("contextMenuToggleSourcePanel") || "Toggle Page Sources",
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addShowDefaultFolder = (contexts: string[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.SHOW_DEFAULT_FOLDER,
    title: getMessage("contextMenuShowDefaultFolder"),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addLastUsed = (contexts: string[]) => {
  const lastUsedTitle = menuState.lastUsedPath || getMessage("contextMenuLastUsed");
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
  const matchMediaValue = Reflect.get(globalThis, "matchMedia");
  const mediaQuery =
    typeof matchMediaValue === "function"
      ? Reflect.apply(matchMediaValue, globalThis, ["(prefers-color-scheme: dark)"])
      : null;
  const darkMode =
    mediaQuery !== null &&
    typeof mediaQuery === "object" &&
    Boolean(Reflect.get(mediaQuery, "matches"));
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

export const clearPathMappings = () => {
  for (const id of Object.keys(menuState.pathMappings)) {
    delete menuState.pathMappings[id];
  }
};

export const addPaths = (pathsArray: string[], contexts: string[]) => {
  clearPathMappings();

  const { items, errors } = buildTree(pathsArray);

  errors.forEach((error) => {
    backgroundRuntime.optionErrors.paths.push(error);
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
    };

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
