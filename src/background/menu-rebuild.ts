import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { splitLines } from "../shared/util.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import {
  addLastUsed,
  addOptions,
  buildTree,
  addRoot,
  addRouteExclusive,
  addSelectionType,
  addShowDefaultFolder,
  addSourcePanel,
  clearPathMappings,
  makeSeparator,
  renderPathTree,
} from "./menu-build.ts";
import { addTabMenus } from "./menu-tabs.ts";

export const rebuildMenus = async (): Promise<void> => {
  await webExtensionApi.contextMenus.removeAll();
  clearPathMappings();

  let contexts: string[] = options.links ? [...MEDIA_TYPES, "link"] : [...MEDIA_TYPES];
  contexts = options.selection ? contexts.concat(["selection"]) : contexts;
  contexts = options.page ? contexts.concat(["page"]) : contexts;

  addTabMenus();

  if (options.routeExclusive) {
    addRouteExclusive(contexts);
    return;
  }

  addRoot(contexts);

  const pathTree = buildTree(splitLines(options.paths));
  const hasPathSection = pathTree.items.length > 0;

  if (options.enableLastLocation) {
    addLastUsed(contexts);
  }
  if (options.enableLastLocation && hasPathSection) {
    makeSeparator(contexts, MENU_IDS.SEPARATOR.LAST_USED);
  }

  renderPathTree(pathTree, contexts);
  if (options.enableLastLocation || hasPathSection) {
    makeSeparator(contexts, MENU_IDS.SEPARATOR.ACTIONS);
  }

  addSelectionType(contexts);
  addShowDefaultFolder(contexts);
  addOptions(contexts);
  addSourcePanel(contexts);
};
