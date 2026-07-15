import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { splitLines } from "../shared/util.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { buildTree } from "../menus/menu-tree.ts";
import {
  addLastUsed,
  addOptions,
  addRecentDestinations,
  addRoot,
  addRouteExclusive,
  addSelectionType,
  addShowDefaultFolder,
  addSourcePanel,
  clearPathMappings,
  makeSeparator,
  renderPathTree,
  type MenuContext,
  menuState,
} from "./menu-build.ts";
import { addTabMenus } from "./menu-tabs.ts";

const performMenuRebuild = async (): Promise<void> => {
  await webExtensionApi.contextMenus.removeAll();
  clearPathMappings();

  let downloadContexts: MenuContext[] = options.links ? [...MEDIA_TYPES, "link"] : [...MEDIA_TYPES];
  downloadContexts = options.selection ? [...downloadContexts, "selection"] : downloadContexts;
  downloadContexts = options.page ? [...downloadContexts, "page"] : downloadContexts;
  const actionContexts: MenuContext[] = downloadContexts.includes("page")
    ? downloadContexts
    : [...downloadContexts, "page"];

  addTabMenus();
  addRoot(actionContexts);

  if (options.routeHideFolderChoices) {
    addRouteExclusive(downloadContexts);
    makeSeparator(downloadContexts, MENU_IDS.SEPARATOR.ACTIONS);
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

let rebuildQueue = Promise.resolve();

export const rebuildMenus = (): Promise<void> => {
  const next = rebuildQueue.catch(() => {}).then(performMenuRebuild);
  rebuildQueue = next;
  return next;
};
