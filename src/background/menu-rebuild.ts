import { options } from "../config/options-data.ts";
import { webExtensionApi } from "../platform/web-extension-api.ts";
import { MEDIA_TYPES } from "../shared/constants.ts";
import { splitLines } from "../shared/util.ts";
import {
  addLastUsed,
  addOptions,
  addPaths,
  addRoot,
  addRouteExclusive,
  addSelectionType,
  addShowDefaultFolder,
  addSourcePanel,
  clearPathMappings,
  makeSeparator,
} from "./menu-build.ts";
import { addTabMenus } from "./menu-tabs.ts";

export const rebuildMenus = async (): Promise<void> => {
  await webExtensionApi.contextMenus.removeAll();
  clearPathMappings();

  let contexts = options.links ? MEDIA_TYPES.concat(["link"]) : MEDIA_TYPES;
  contexts = options.selection ? contexts.concat(["selection"]) : contexts;
  contexts = options.page ? contexts.concat(["page"]) : contexts;

  addTabMenus();

  if (options.routeExclusive) {
    addRouteExclusive(contexts);
    return;
  }

  addRoot(contexts);

  if (options.enableLastLocation) {
    addLastUsed(contexts);
    makeSeparator(contexts);
  }

  addPaths(splitLines(options.paths), contexts);
  makeSeparator(contexts);

  addSelectionType(contexts);
  addShowDefaultFolder(contexts);
  addOptions(contexts);
  addSourcePanel(contexts);
};
