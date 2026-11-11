import { webExtensionApi } from "../platform/web-extension-api.ts";
import { getMessage } from "../platform/localization.ts";
import type { CurrentTab } from "../platform/current-tab.ts";
import { options } from "../config/options-data.ts";
import { MENU_IDS } from "../menus/menu-ids.ts";
import { buildTree } from "../menus/menu-tree.ts";
import { selectableDestinations } from "../menus/selectable-destinations.ts";
import { DOWNLOAD_TYPES } from "../shared/constants.ts";
import {
  PICKER_OPEN_REQUEST,
  type PickerItem,
  type PickerModel,
  type PickerSource,
} from "../shared/destination-picker.ts";
import { isStringKeyedRecord, splitLines } from "../shared/util.ts";
import { backgroundRuntime } from "./runtime.ts";
import { getLastUsed, menuState } from "./menu-build.ts";
import { lastUsedMenuExists } from "./menu-click.ts";
import { resolveClickTarget } from "./menu-target.ts";
import { resolveMenuAccessKey } from "../menus/access-key.ts";
import { hoveredClickInfo, readHoveredSource } from "./hovered-source.ts";
import { requestTopFrame } from "./tab-request.ts";

// The opt-in in-page destination picker (#77, #21). It never replaces the
// browser context menu: it opens only from an unbound command, an opt-in
// click-to-save setting, or an allowed extension's request. What it lists is
// what the context menu currently offers, and a choice is saved as a click on
// that menu item, so the two cannot disagree about a destination.

// The content script asks for the model before it answers, so this spans two
// messages rather than the one a hovered-source lookup needs.
const PICKER_OPEN_TIMEOUT_MS = 2_000;

export type PickerMenu = { model: PickerModel; selectable: ReadonlySet<string> };

export const buildPickerMenu = (privateContext: boolean): PickerMenu => {
  const copy = {
    title: getMessage("pickerTitle"),
    filter: getMessage("pickerFilter"),
    empty: getMessage("pickerNoMatches"),
    lastUsed: getMessage("contextMenuLastUsed"),
  };
  // Quick save only removes every destination from the menu, so there is
  // nothing for a picker to offer either.
  if (options.quickSaveEnabled && options.quickSaveOnly) {
    return { model: { lastUsed: null, items: [], copy }, selectable: new Set() };
  }
  if (options.routeHideFolderChoices) {
    const item: PickerItem = {
      kind: "path",
      id: MENU_IDS.ROUTE_EXCLUSIVE,
      title: getMessage("contextMenuExclusive"),
      parentId: null,
    };
    return { model: { lastUsed: null, items: [item], copy }, selectable: new Set([item.id]) };
  }
  // A private tab sees only the private Last used destination, as its context
  // menu does, so a regular window's folder never appears in a private page.
  const stored = getLastUsed(privateContext && !options.persistPrivateActivity);
  const tree = buildTree(splitLines(options.paths));
  // The keys the context menu itself would show: an item's own `(key: x)`,
  // else its number within its menu level when numbering is on. Submenu
  // headings keep theirs too, so "2 then 1" reaches the same folder here.
  const withKey = (key: string | null): { key?: string } =>
    key === null ? {} : { key: key.toLowerCase() };
  const lastUsed =
    lastUsedMenuExists() && stored.path
      ? {
          id: MENU_IDS.LAST_USED,
          title: stored.meta?.title || stored.path,
          ...withKey(resolveMenuAccessKey(options.keyLastUsed)),
        }
      : null;
  const items = tree.items.flatMap((item): PickerItem[] => {
    if (item.kind === "separator") return [{ kind: "separator" }];
    // Only ids the click handler can resolve are ever offered.
    if (!menuState.pathMappings[item.id]) return [];
    return [
      {
        kind: "path",
        id: item.id,
        title: item.title,
        parentId: item.parentId === MENU_IDS.ROOT ? null : item.parentId,
        ...withKey(
          resolveMenuAccessKey(
            options.enableNumberedItems ? item.number : "",
            item.accessKeyOverride,
          ),
        ),
      },
    ];
  });
  const selectable = new Set([
    ...(lastUsed ? [lastUsed.id] : []),
    ...selectableDestinations(tree)
      .filter((item) => menuState.pathMappings[item.id])
      .map((item) => item.id),
  ]);
  return { model: { lastUsed, items, copy }, selectable };
};

// What a menu click in this tab would save for the element under the pointer.
// `undefined` means nothing at all: no media or usable link, and page saves
// are off. `null` is the page. A link the link settings exclude resolves to
// the page here, exactly as the browser menu would offer for it.
export const pickerSourceForTab = async (
  tab: CurrentTab & { url: string },
): Promise<PickerSource | null | undefined> => {
  const hovered = await readHoveredSource(tab);
  const target = resolveClickTarget(
    { pageUrl: tab.url, ...hoveredClickInfo(hovered) },
    options,
    tab,
  );
  if (!target) return undefined;
  return target.downloadType === DOWNLOAD_TYPES.PAGE ? null : hovered;
};

// Resolves false when the page shows no picker: a restricted page, a site on
// the disable list, a content script from an older version, or no destination
// to offer. Callers treat that as "nothing happened".
export const openPickerInTab = async (
  tab: CurrentTab | null | undefined,
  source: PickerSource | null,
): Promise<boolean> => {
  const response = await requestTopFrame(
    tab,
    { type: PICKER_OPEN_REQUEST, body: { source } },
    PICKER_OPEN_TIMEOUT_MS,
  );
  return isStringKeyedRecord(response) && response.opened === true;
};

export const openPickerForActiveTab = async (): Promise<void> => {
  if (backgroundRuntime.ready) {
    await backgroundRuntime.ready;
  }
  const [tab] = await webExtensionApi.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!tab || url == null) return;
  const source = await pickerSourceForTab({ ...tab, url });
  if (source !== undefined) await openPickerInTab(tab, source);
};
