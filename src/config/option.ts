import { webExtensionApi } from "../platform/web-extension-api.ts";

import {
  OPTION_KEYS,
  OPTION_TYPES,
  type SaveInOptionName,
  type SaveInOptions,
} from "./option-schema.ts";
// The options bag is a pure leaf (options-data.ts) so modules that only READ
// settings (path/headers/menu-*/notification/download) import it directly and
// don't pull in this validator-heavy module — breaking the option↔* cycles
// (docs/ARCH-CYCLES.md, Cut 1).
import { options, replaceOptions, resetOptions } from "./options-data.ts";
import { isContentOptionName, normalizeContentOption } from "./content-options.ts";

export interface OptionsManagementApi {
  OPTION_TYPES: typeof OPTION_TYPES;
  OPTION_KEYS: typeof OPTION_KEYS;
  OPTION_DESCRIPTIONS: Record<string, string>;
  getKeys(): SaveInOptionName[];
  setOption<Name extends SaveInOptionName>(
    name: Name,
    value: SaveInOptions[Name] | undefined,
  ): void;
  loadOptions(): Promise<SaveInOptions>;
}

export const OptionsManagement: OptionsManagementApi = {
  OPTION_TYPES, // re-export

  OPTION_KEYS,

  // One-line human descriptions, surfaced by the GET_SCHEMA API so an agent (or
  // a human reading the schema) knows what each option does
  OPTION_DESCRIPTIONS: {
    conflictAction: "Filename-collision behaviour: uniquify, overwrite, or prompt (Firefox only).",
    contentClickToSave: "Enable click-to-save: hold the modifier and click media to save it.",
    contentClickToSaveCombo:
      "Modifiers to hold for click-to-save; legacy raw keyCodes remain supported.",
    contentClickToSaveButton: "Mouse button for click-to-save.",
    sourcePanelEnabled: "Enable the toolbar source browser for DOM-visible page media.",
    sourcePanelBackgrounds: "Include URLs found in computed CSS background images.",
    sourcePanelLive: "Refresh the source list when page DOM media changes.",
    sourcePanelPreviews: "Load image and video thumbnails in the source list.",
    sourcePanelResourceHints: "Best-effort discovery of HLS and DASH manifests in resource timing.",
    sourcePanelLinks: "Include safe page links, classifying linked media and PDF documents.",
    debug: "Write extra routing and download details to the browser developer console.",
    uiLocale: "Options, menu, and notification language (blank = browser default).",
    enableLastLocation: "Show a 'last used' item at the top of the menu.",
    enableNumberedItems: "Add number-key access keys to submenu items.",
    filenamePatterns: "Routing/rename rules (matcher / capture / into blocks).",
    keyLastUsed: "Access key for the 'last used' menu item.",
    keyRoot: "Access key for the root 'Save In' menu.",
    links: "Enable saving of links.",
    preferLinks: "Always prefer the link over the media source.",
    preferLinksFilterEnabled: "Only prefer links on pages matching the filter.",
    preferLinksFilter: "URL match pattern for preferring links.",
    notifyDuration: "Auto-dismiss notifications after this many milliseconds.",
    notifyOnFailure: "Notify when a download fails.",
    notifyOnRuleMatch: "Notify when a routing rule matches.",
    notifyOnSuccess: "Notify when a download completes.",
    notifyOnLinkPreferred: "Notify when a link was saved instead of the source.",
    page: "Enable saving of the current page.",
    paths: "The directory menu structure (one path per line; '>' for submenus).",
    prompt: "Always open the Save As dialog.",
    promptIfNoExtension: "Open Save As when the filename has no extension.",
    promptOnFailure: "Re-prompt with Save As when a download fails.",
    promptOnShift: "Open Save As when Shift is held on click.",
    replacementChar: "Replaces filesystem-forbidden characters (blank = delete them).",
    routeExclusive: "Only save via routing rules; disables the directory submenu.",
    routeFailurePrompt: "Open Save As when no routing rule matches.",
    selection: "Enable saving selected text as a .txt file.",
    shortcutLink: "Save links as shortcut files instead of downloading.",
    shortcutMedia: "Save media as shortcut files instead of downloading.",
    shortcutPage: "Save pages as shortcut files.",
    shortcutTab: "Save tabs as shortcut files from the browser tab menu.",
    shortcutType: "Shortcut file format (HTML redirect, legacy .url, .desktop, or .webloc).",
    truncateLength: "Truncate each path segment to this many characters (0 = no limit).",
    appendMimeExtension:
      "Append a file extension from the server's Content-Type when the filename has none.",
    fetchViaFetch: "Download via the Fetch API instead of the downloads API.",
    fallbackFetch: "Retry a failed download once via a background fetch.",
    includeFetchCredentials:
      "Include applicable website cookies and browser-managed authentication in non-private extension fetches.",
    externalDownloadAllowlist:
      "Extension IDs allowed to start downloads through the external API, one per line.",
    trackBrowserDownloads: "Include ordinary browser downloads in local Save In history.",
    routeBrowserDownloads:
      "Apply matching filename routing rules to ordinary browser downloads on Chrome.",
    browserDownloadFilter:
      "Optional URL match patterns limiting which ordinary browser downloads are handled.",
    browserDownloadExcludeFilter:
      "Optional URL match patterns excluding ordinary browser downloads from handling.",
    routeBrowserDownloadsFirefox:
      "Experimentally cancel and re-download matching ordinary downloads on Firefox.",
    tabEnabled: "Enable the tab-strip context menu (Firefox or Chrome 150+).",
    closeTabOnSave: "Close a tab after saving it.",
    setRefererHeader: "Set the Referer header to the page URL for matching sites.",
    setRefererHeaderFilter: "URL match patterns for the Referer header.",
  },

  getKeys: () => OptionsManagement.OPTION_KEYS.map((option) => option.name),

  setOption: <Name extends SaveInOptionName>(
    name: Name,
    value: SaveInOptions[Name] | undefined,
  ) => {
    if (typeof value !== "undefined") {
      options[name] = value;
    }
  },

  loadOptions: () =>
    webExtensionApi.storage.local.get(OptionsManagement.getKeys()).then((loadedOptions) => {
      loadedOptions = loadedOptions && typeof loadedOptions === "object" ? loadedOptions : {};
      const nextOptions = {} as SaveInOptions;

      OptionsManagement.OPTION_KEYS.forEach((optionType) => {
        const k = optionType.name;
        const stored = loadedOptions[k];
        if (isContentOptionName(k)) {
          nextOptions[k] = normalizeContentOption(k, stored) as never;
          return;
        }
        if (typeof stored === "undefined") {
          nextOptions[k] = optionType.default as never;
          return;
        }
        const validate =
          "validate" in optionType
            ? (optionType.validate as (value: unknown) => boolean)
            : undefined;
        const validType =
          optionType.type === OPTION_TYPES.BOOL
            ? typeof stored === "boolean"
            : typeof stored === typeof optionType.default ||
              (typeof optionType.default === "number" &&
                typeof stored === "string" &&
                stored.trim() !== "" &&
                Number.isFinite(Number(stored)));
        if (
          !validType ||
          (typeof stored === "number" && !Number.isFinite(stored)) ||
          (validate && !validate(stored))
        ) {
          nextOptions[k] = optionType.default as never;
          return;
        }
        const fn: (value: unknown) => unknown =
          "onLoad" in optionType
            ? (optionType.onLoad as (value: unknown) => unknown)
            : (value) => value;
        try {
          nextOptions[k] = fn(stored) as never;
        } catch {
          // Profiles and imported settings can outlive their parser/migration.
          // One corrupt option must not prevent the background page from starting.
          nextOptions[k] = optionType.default as never;
        }
      });

      // Commit a complete snapshot only after every stored value has been
      // normalized. Keys removed by reset therefore return to their defaults,
      // and readers never observe a half-reloaded options bag.
      replaceOptions(nextOptions);
      return options;
    }),
};

// Seed the options bag with every key's default. loadOptions() only overlays
// the keys present in storage, so the defaults must be in place first. Deferred
// out of module eval (Task #2): the entry calls it synchronously at startup, so
// importing option.ts is side-effect-free (tests import the real bag and set
// only the fields they exercise).
export const seedOptions = () => {
  // Mutate the shared bag in place (it's a `const` leaf export now) so every
  // module's live reference stays valid across a background runtime reset
  resetOptions(OptionsManagement.OPTION_KEYS.map((val) => [val.name, val.default] as const));
  return options;
};
