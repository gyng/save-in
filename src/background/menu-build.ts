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
import type { MenuTree, TabAction } from "../menus/menu-tree.ts";
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
  tabAction?: TabAction;
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

// The dynamic-default menu checkbox flips the effective Quick save destination
// at runtime. Mirroring it to storage.local (the same area options load from)
// is what lets the choice survive an MV3 service-worker restart.
export const setQuickSaveUseDirectory = (active: boolean): Promise<void> => {
  options.quickSaveUseDirectory = active;
  return webExtensionApi.storage.local.set({ quickSaveUseDirectory: active }).catch(() => {});
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
    ...menuState.recentDestinations.filter((entry) => entry.path !== path),
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

  // Search the original string per code point rather than a lowercased copy:
  // U+0130 "İ" is the one character whose lowercase is longer than itself
  // (i + U+0307), so an offset taken from str.toLowerCase() runs a unit ahead
  // of str for every "İ" before the match — marking the neighbouring character
  // or, at the end of a title, overrunning it and leaving a lone "&".
  const needle = accessKey.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  let offset = 0;
  for (const character of str) {
    if (character.toLowerCase() === needle) {
      matchIndex = offset;
      matchLength = character.length;
      break;
    }
    offset += character.length;
  }

  if (matchIndex === -1) return `${escapeAmpersands(str)} (&${accessKey})`;
  return `${escapeAmpersands(str.slice(0, matchIndex))}&${str.slice(
    matchIndex,
    matchIndex + matchLength,
  )}${escapeAmpersands(str.slice(matchIndex + matchLength))}`;
};

export const addRoot = (contexts: readonly MenuContext[]) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.ROOT,
    title: setAccesskey(getMessage("contextMenuRoot"), options.keyRoot),
    contexts: asMenuContexts(contexts),
  });
};

export const addQuickSave = (
  contexts: readonly MenuContext[],
  { topLevel = false }: { topLevel?: boolean } = {},
) => {
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.QUICK_SAVE,
    // Top-level Quick save stands alone in the menu, so it has to name the
    // extension the way the root item otherwise would.
    title: setAccesskey(
      topLevel
        ? getMessage("contextMenuQuickSaveOnly") || "Quick save (Save In)"
        : getMessage("contextMenuQuickSave") || "Quick save",
      topLevel ? options.keyRoot : "",
    ),
    contexts: asMenuContexts(contexts),
    ...(topLevel ? {} : { parentId: MENU_IDS.ROOT }),
  });
};

// A configured Quick save folder is only worth surfacing as a runtime toggle
// when it differs from the Downloads root; a checkbox that switched between two
// identical destinations would be noise. Invalid stored paths are ignored so a
// corrupt profile value never shows an unusable toggle.
export const quickSaveDirectoryConfigured = (): boolean => {
  const directory = options.quickSaveDirectory.trim();
  return directory !== "" && directory !== "." && new Path(directory).validate().valid;
};

export const addQuickSaveToDirectory = (contexts: readonly MenuContext[]) => {
  const directory = options.quickSaveDirectory.trim();
  webExtensionApi.contextMenus.create({
    id: MENU_IDS.QUICK_SAVE_TO_DIRECTORY,
    type: "checkbox",
    checked: options.quickSaveUseDirectory,
    // The folder name is user text landing in access-key markup, where a lone
    // "&" flags the next character and disappears. setAccesskey with no key
    // escapes without claiming one, as the recent destinations do.
    title: setAccesskey(
      getMessage("contextMenuQuickSaveToDirectory", [directory]) || `Save to ${directory}`,
      "",
    ),
    contexts: asMenuContexts(contexts),
    parentId: MENU_IDS.ROOT,
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

// renderPathTree only appends, so the list has to be emptied by whoever is
// about to re-render the tree it describes. resetRuntimeDiagnostics covers
// init and reset, but a save rebuilds the menus to reorder recent
// destinations without passing through either — so without this the same bad
// line is counted again on every save, for the whole background lifetime.
export const clearPathErrors = () => {
  backgroundRuntime.optionErrors.paths.length = 0;
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
      ...(item.tabAction ? { tabAction: item.tabAction } : {}),
    };

    webExtensionApi.contextMenus.create({
      id: item.id,
      // The toggle only chooses whether items get an automatic number. An
      // explicit (key:) is a per-item request the user wrote by hand, so it
      // still applies with numbering off — an empty key resolves to no
      // access key at all.
      title: setAccesskey(
        item.title,
        options.enableNumberedItems ? item.number : "",
        item.accessKeyOverride,
      ),
      contexts: asMenuContexts(contexts),
      parentId: item.parentId,
    });
  });
};
