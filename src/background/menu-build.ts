import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";

// Context menu construction: parses the paths option into a menu tree
// (`buildTree`, pure) and renders it with webExtensionApi.contextMenus.create.
// Click handling lives in menu-click.ts and tab-strip menus in menu-tabs.ts.

import { options } from "../config/options-data.ts";
import {
  LAST_USED_META_STORAGE_KEY,
  LAST_USED_PATH_STORAGE_KEY,
  RECENT_DESTINATIONS_STORAGE_KEY,
} from "../shared/storage-keys.ts";
import { MAX_RECENT_DESTINATIONS, MEDIA_TYPES } from "../shared/constants.ts";
import { Path } from "../routing/path.ts";
import { isStringKeyedRecord } from "../shared/util.ts";
import { backgroundRuntime } from "./runtime.ts";
import type { MenuTree } from "../menus/menu-tree.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { resolveMenuAccessKey } from "../menus/access-key.ts";

export { MENU_IDS } from "../menus/menu-ids.ts";

type MenuContexts = NonNullable<
  Parameters<typeof webExtensionApi.contextMenus.create>[0]["contexts"]
>;
export type MenuContext = MenuContexts[number];
const asMenuContexts = (contexts: readonly MenuContext[]): MenuContexts => {
  const [first, ...rest] = contexts;
  return first === undefined ? ["all"] : [first, ...rest];
};
type LastUsedMeta = {
  comment?: string;
  menuIndex?: string;
  title?: string;
  prompt?: boolean;
};
export type RecentDestination = {
  path: string;
  meta: { comment: string; menuIndex: string; title: string; prompt?: boolean };
};
type MenuPathMapping = {
  parsedDir: string;
  comment: string;
  menuIndex: string;
  title: string;
  prompt?: boolean;
};

// This is genuine mutable application state shared by menu construction and
// click handling. Functions stay as module exports instead of being attached
// to this record.
export const menuState: {
  lastUsedPath: string | null;
  lastUsedMeta: LastUsedMeta | null;
  recentDestinations: RecentDestination[];
  pathMappings: Record<string | number, MenuPathMapping>;
} = {
  lastUsedPath: null,
  lastUsedMeta: null,
  recentDestinations: [],
  pathMappings: {},
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

const normalizeLastUsedMeta = (value: unknown): LastUsedMeta | null => {
  if (!isStringKeyedRecord(value)) return null;
  const { comment, menuIndex, title, prompt } = value;
  if (
    (comment !== undefined && typeof comment !== "string") ||
    (menuIndex !== undefined && typeof menuIndex !== "string") ||
    (title !== undefined && typeof title !== "string") ||
    (prompt !== undefined && typeof prompt !== "boolean")
  ) {
    return null;
  }
  return {
    ...(typeof comment === "string" ? { comment } : {}),
    ...(typeof menuIndex === "string" ? { menuIndex } : {}),
    ...(typeof title === "string" ? { title } : {}),
    ...(typeof prompt === "boolean" ? { prompt } : {}),
  };
};

const normalizeRecentDestinations = (value: unknown): RecentDestination[] => {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (!isStringKeyedRecord(entry) || typeof entry.path !== "string") return [];
      const meta = normalizeLastUsedMeta(entry.meta);
      if (!meta || typeof meta.comment !== "string" || typeof meta.menuIndex !== "string")
        return [];
      const path = entry.path;
      if (!path || !new Path(path).validate().valid) return [];
      return [
        {
          path,
          meta: {
            comment: meta.comment,
            menuIndex: meta.menuIndex,
            title: meta.title || path,
            ...(meta.prompt === true ? { prompt: true } : {}),
          },
        },
      ];
    })
    .slice(0, MAX_RECENT_DESTINATIONS);
};

const recentDestinationsEqual = (
  left: readonly RecentDestination[],
  right: readonly RecentDestination[],
): boolean =>
  left.length === right.length &&
  left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.meta.comment === other.meta.comment &&
      entry.meta.menuIndex === other.meta.menuIndex &&
      entry.meta.title === other.meta.title &&
      entry.meta.prompt === other.meta.prompt
    );
  });

export const recordRecentDestination = (
  path: string,
  meta: RecentDestination["meta"],
  privateContext = false,
): Promise<boolean> => {
  if (privateContext) return Promise.resolve(false);
  const next = [
    { path, meta },
    ...menuState.recentDestinations.filter(
      (entry) => entry.path !== path || entry.meta.comment !== meta.comment,
    ),
  ].slice(0, MAX_RECENT_DESTINATIONS);
  if (recentDestinationsEqual(menuState.recentDestinations, next)) {
    return Promise.resolve(false);
  }
  menuState.recentDestinations = next;
  return webExtensionApi.storage.local
    .set({ [RECENT_DESTINATIONS_STORAGE_KEY]: next })
    .catch(() => {})
    .then(() => true);
};

export const restoreLastUsed = (stored: unknown) => {
  const path = isStringKeyedRecord(stored) ? stored.lastUsedPath : undefined;
  const meta = isStringKeyedRecord(stored) ? stored.lastUsedMeta : undefined;
  menuState.lastUsedPath =
    typeof path === "string" && path && new Path(path).validate().valid ? path : null;
  menuState.lastUsedMeta = menuState.lastUsedPath ? normalizeLastUsedMeta(meta) : null;
  menuState.recentDestinations = normalizeRecentDestinations(
    isStringKeyedRecord(stored) ? stored[RECENT_DESTINATIONS_STORAGE_KEY] : undefined,
  );
};

export const addRecentDestinations = (contexts: readonly MenuContext[]): void => {
  const destinations = menuState.recentDestinations.slice(0, options.recentDestinationCount);
  if (destinations.length === 0) return;
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.RECENT,
    title: getMessage("contextMenuRecentLocations") || "Recent locations",
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
  destinations.forEach(({ path, meta }, index) => {
    const id = MENU_IDS.recentDestination(index);
    menuState.pathMappings[id] = {
      parsedDir: path,
      comment: meta.comment,
      menuIndex: meta.menuIndex,
      title: meta.title,
      ...(meta.prompt === true ? { prompt: true } : {}),
    };
    webExtensionApi.contextMenus.create({
      id,
      title: setAccesskey(meta.title, ""),
      contexts: asMenuContexts(contexts),
      parentId: MENU_IDS.RECENT,
    });
  });
};

export const makeSeparator = (
  contexts: readonly MenuContext[],
  id: string,
  parentId: string = MENU_IDS.ROOT,
): void => {
  webExtensionApi.contextMenus.create({
    id,
    type: "separator",
    contexts: asMenuContexts(contexts),
    parentId,
  });
};

export const setAccesskey = (str: string, key: string | number, override?: string) => {
  const accessKey = resolveMenuAccessKey(key, override);
  const escapeAmpersands = (value: string) => value.replaceAll("&", "&&");
  if (accessKey === null) return escapeAmpersands(str);

  const matchIndex = str.toLowerCase().indexOf(accessKey.toLowerCase());
  if (matchIndex === -1) return `${escapeAmpersands(str)} (&${accessKey})`;
  return `${escapeAmpersands(str.slice(0, matchIndex))}&${str.slice(
    matchIndex,
    matchIndex + accessKey.length,
  )}${escapeAmpersands(str.slice(matchIndex + accessKey.length))}`;
};

export const addRoot = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROOT,
    title: setAccesskey(getMessage("contextMenuRoot"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addRouteExclusive = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROUTE_EXCLUSIVE,
    title: setAccesskey(getMessage("contextMenuExclusive"), options.keyRoot),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addSelectionType = (contexts: readonly MenuContext[]) => {
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

export const addOptions = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.OPTIONS,
    title: getMessage("contextMenuItemOptions"),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addSourcePanel = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.TOGGLE_SOURCE_PANEL,
    title: getMessage("contextMenuToggleSourcePanel") || "Toggle Page Sources",
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addShowDefaultFolder = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.SHOW_DEFAULT_FOLDER,
    title: getMessage("contextMenuShowDefaultFolder"),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
  });
};

export const addLastUsed = (contexts: readonly MenuContext[]) => {
  const lastUsedTitle =
    menuState.lastUsedMeta?.title || menuState.lastUsedPath || getMessage("contextMenuLastUsed");
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

export const renderPathTree = ({ items, errors }: MenuTree, contexts: readonly MenuContext[]) => {
  errors.forEach((error) => {
    backgroundRuntime.optionErrors.paths.push(error);
  });

  items.forEach((item) => {
    if (item.kind === "separator") {
      makeSeparator(contexts, item.id, item.parentId);
      return;
    }

    menuState.pathMappings[item.id] = {
      parsedDir: item.parsedDir,
      comment: item.comment,
      menuIndex: item.menuIndex,
      title: item.title,
      ...(item.prompt === true ? { prompt: true } : {}),
    };

    webExtensionApi.contextMenus.create({
      id: item.id,
      title: setAccesskey(
        item.title,
        options.enableNumberedItems ? item.number : "",
        options.enableNumberedItems ? item.accessKeyOverride : "",
      ),
      contexts: asMenuContexts(contexts),
      parentId: item.parentId,
    });
  });
};
