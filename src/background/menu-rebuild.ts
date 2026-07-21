import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { splitLines } from "../shared/util.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { buildTree } from "../menus/menu-tree.ts";
import {
  addLastUsed,
  addOptions,
  addQuickSave,
  addQuickSaveToDirectory,
  addRecentDestinations,
  addRoot,
  addRouteExclusive,
  addSelectionType,
  addShowDefaultFolder,
  addSourcePanel,
  clearPathErrors,
  clearPathMappings,
  makeSeparator,
  quickSaveDirectoryConfigured,
  renderPathTree,
  type MenuContext,
  menuState,
} from "./menu-build.ts";
import { addTabMenus } from "./menu-tabs.ts";

const performMenuRebuild = async (): Promise<void> => {
  await webExtensionApi.contextMenus.removeAll();
  clearPathMappings();
  clearPathErrors();

  let downloadContexts: MenuContext[] = options.links ? [...MEDIA_TYPES, "link"] : [...MEDIA_TYPES];
  downloadContexts = options.selection ? [...downloadContexts, "selection"] : downloadContexts;
  downloadContexts = options.page ? [...downloadContexts, "page"] : downloadContexts;
  const actionContexts: MenuContext[] = downloadContexts.includes("page")
    ? downloadContexts
    : [...downloadContexts, "page"];

  addTabMenus();

  // #144 asked to drop the submenu hop before a save. Both browsers collapse an
  // extension's items into a submenu named after it only once there is more than
  // one, so a single top-level Quick save is the only shape that reaches a save
  // in one click — every extra item here would rebuild the very submenu this
  // removes. That is the whole trade: no folders, no Last used, no Options or
  // Source panel in the page menu. Tab menus keep their own context and do not
  // count toward this one.
  if (options.quickSaveEnabled && options.quickSaveOnly) {
    addQuickSave(downloadContexts, { topLevel: true });
    return;
  }

  addRoot(actionContexts);

  if (options.quickSaveEnabled) {
    addQuickSave(downloadContexts);
    if (quickSaveDirectoryConfigured()) {
      addQuickSaveToDirectory(downloadContexts);
    }
  }

  if (options.routeHideFolderChoices) {
    addRouteExclusive(downloadContexts);
    makeSeparator(downloadContexts, MENU_IDS.SEPARATOR.ACTIONS);
    addSelectionType(downloadContexts);
    addShowDefaultFolder(downloadContexts);
    addOptions(downloadContexts);
    addSourcePanel(actionContexts);
    return;
  }

  const pathTree = buildTree(splitLines(options.paths));
  const hasPathSection = pathTree.items.some((item) => item.kind === "path");

  if (options.enableLastLocation) {
    addLastUsed(downloadContexts);
  }
  addRecentDestinations(downloadContexts);
  const hasQuickLocations =
    options.enableLastLocation ||
    (options.recentDestinationCount > 0 && menuState.recentDestinations.length > 0);
  if (hasQuickLocations && hasPathSection) {
    makeSeparator(downloadContexts, MENU_IDS.SEPARATOR.LAST_USED);
  }

  renderPathTree(pathTree, downloadContexts);
  if (hasQuickLocations || hasPathSection) {
    makeSeparator(downloadContexts, MENU_IDS.SEPARATOR.ACTIONS);
  }

  addSelectionType(downloadContexts);
  addShowDefaultFolder(downloadContexts);
  addOptions(downloadContexts);
  addSourcePanel(actionContexts);
};

let runningRebuild: Promise<void> | null = null;
let rebuildQueued = false;

// Serialize rebuilds (removeAll + recreate must never interleave) and coalesce a
// burst during an in-flight rebuild into a single trailing pass — only the final
// menu state is observable, so N back-to-back requests need one extra rebuild,
// not N. A failed pass must not abandon a queued trailing pass (the menu would
// stay stale until an unrelated event), so failures are held and the drain keeps
// going; the shared promise rejects only when the final pass failed, since a
// later successful pass supersedes the broken state. `runningRebuild` is cleared
// only after the loop fully drains (a synchronous check with no awaited gap in
// between), so a fresh request can never start a second concurrent rebuild.
const drainRebuilds = async (): Promise<void> => {
  let failure: { error: unknown } | null = null;
  try {
    do {
      rebuildQueued = false;
      try {
        await performMenuRebuild();
        failure = null;
      } catch (error) {
        failure = { error };
      }
    } while (rebuildQueued);
  } finally {
    runningRebuild = null;
  }
  if (failure) {
    throw failure.error;
  }
};

export const rebuildMenus = (): Promise<void> => {
  rebuildQueued = true;
  runningRebuild ??= drainRebuilds();
  return runningRebuild;
};
