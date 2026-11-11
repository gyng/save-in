import { webExtensionApi } from "../platform/web-extension-api.ts";
import { options } from "../config/options-data.ts";
import {
  MENU_IDS,
  OPEN_PICKER_COMMAND,
  SAVE_FOLDER_COMMANDS,
  SAVE_LAST_USED_COMMAND,
} from "../menus/menu-ids.ts";
import { buildTree } from "../menus/menu-tree.ts";
import { selectableDestinations } from "../menus/selectable-destinations.ts";
import { splitLines } from "../shared/util.ts";
import { backgroundRuntime } from "./runtime.ts";
import { menuState } from "./menu-build.ts";
import { handleContextMenuClick, lastUsedMenuExists } from "./menu-click.ts";
import { hoveredClickInfo, readHoveredSource } from "./hovered-source.ts";
import { openPickerForActiveTab } from "./destination-picker.ts";

// Keyboard commands for Last used and the first few folders (#15). Each one is
// the menu item it names, picked for whatever the pointer is over: the save
// goes through the menu click handler, so routing, Last used, prompts, private
// isolation, and History cannot drift from the menu's behavior.

const isSaveCommand = (command: string): boolean =>
  command === SAVE_LAST_USED_COMMAND || SAVE_FOLDER_COMMANDS.some((name) => name === command);

// The commands that act on what the pointer is over in the active tab.
export const isPointerCommand = (command: string): boolean =>
  command === OPEN_PICKER_COMMAND || isSaveCommand(command);

// A command acts only on an item the menu currently offers. With the folder
// list hidden, or Last used switched off, there is no such item to pick, and a
// bound key must not reach a destination the user removed from the menu.
const commandMenuItemId = (command: string): string | null => {
  if (command === SAVE_LAST_USED_COMMAND) {
    return lastUsedMenuExists() ? MENU_IDS.LAST_USED : null;
  }
  const folderIndex = SAVE_FOLDER_COMMANDS.findIndex((name) => name === command);
  const folder = selectableDestinations(buildTree(splitLines(options.paths)))[folderIndex];
  return folder && menuState.pathMappings[folder.id] ? folder.id : null;
};

const runSaveCommand = async (command: string): Promise<void> => {
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready;
  }
  const menuItemId = commandMenuItemId(command);
  if (menuItemId === null) return;
  const [tab] = await webExtensionApi.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.url == null) return;
  // No frameId: the handler reads a frame-bound click as a real right-click
  // and would look up the image an earlier context menu was opened on.
  await handleContextMenuClick(
    { menuItemId, pageUrl: tab.url, ...hoveredClickInfo(await readHoveredSource(tab)) },
    tab,
  );
};

export const runPointerCommand = (command: string): Promise<void> =>
  command === OPEN_PICKER_COMMAND ? openPickerForActiveTab() : runSaveCommand(command);
