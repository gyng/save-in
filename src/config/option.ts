import { webExtensionApi } from "../platform/web-extension-api.ts";

import {
  OPTION_KEYS,
  OPTION_TYPES,
  defaultOptions,
  type SaveInOptionName,
  type SaveInOptions,
} from "./option-schema.ts";
// The options bag is a pure leaf so read-only consumers do not pull this
// validator-heavy module into the background dependency graph.
import { options, replaceOptions, resetOptions } from "./options-data.ts";
import { isContentOptionName, normalizeContentOption } from "./content-options.ts";
import {
  PATH_TRUNCATION_MIGRATION_STORAGE_KEY,
  PATH_TRUNCATION_MIGRATION_VERSION,
} from "../shared/storage-keys.ts";
import { migrateLegacyAutoDownloadRules } from "../automation/auto-download-rules.ts";
import { parseRules } from "../routing/router.ts";

export interface OptionsManagementApi {
  OPTION_TYPES: typeof OPTION_TYPES;
  OPTION_KEYS: typeof OPTION_KEYS;
  OPTION_DESCRIPTIONS: Record<SaveInOptionName, string>;
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
    autoDownloadEnabled:
      "Automatically save page sources that match routing rules with context: auto.",
    autoDownloadRules:
      "Legacy automatic-source rule field; valid stored rules migrate into filenamePatterns.",
    autoDownloadLive: "Watch for matching sources added after the page initially loads.",
    autoDownloadPrivate: "Allow automatic source saving in private browsing windows.",
    autoDownloadMaxPerPage: "Maximum automatic saves allowed during one page visit.",
    sourcePanelEnabled: "Enable the toolbar source browser for DOM-visible page media.",
    sourcePanelBackgrounds: "Include URLs found in computed CSS background images.",
    sourcePanelLive: "Refresh the source list when page DOM media changes.",
    sourcePanelPreviews: "Load image and video thumbnails in the source list.",
    sourcePanelResourceHints: "Best-effort discovery of HLS and DASH manifests in resource timing.",
    sourcePanelLinks: "Include safe page links, classifying linked media and PDF documents.",
    uiTheme: "Color theme shared by the options page and Page Sources.",
    debug: "Write extra routing and download details to the browser developer console.",
    uiLocale: "Options, menu, and notification language (blank = browser default).",
    enableLastLocation: "Show a 'last used' item at the top of the menu.",
    recentDestinationCount: "Number of recently used destinations shown in the context menu (0–5).",
    enableNumberedItems: "Add number-key access keys to submenu items.",
    filenamePatterns:
      "Routing/rename rules, including guarded automatic-source rules with context: auto.",
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
    routeExclusive:
      "Legacy combined routing-only mode; migrated to separate menu and unmatched-file options.",
    routeFailurePrompt: "Open Save As when no routing rule matches.",
    routeHideFolderChoices: "Hide folder choices from the Save In context menu.",
    routeSkipUnmatched: "Do not save a file when no routing rule matches.",
    selection: "Enable saving selected text as a .txt file.",
    shortcutLink: "Save links as shortcut files instead of downloading.",
    shortcutMedia: "Save media as shortcut files instead of downloading.",
    shortcutPage: "Save pages as shortcut files.",
    shortcutTab: "Save tabs as shortcut files from the browser tab menu.",
    saveSourceSidecar: "Save media together with a shortcut sidecar that records its source URL.",
    shortcutType: "Shortcut file format (HTML redirect, legacy .url, .desktop, or .webloc).",
    truncateLength: "Limit each file or folder name to this many UTF-8 bytes (0 = no limit).",
    appendMimeExtension:
      "Append a file extension from the server's Content-Type when the filename has none.",
    fetchViaFetch: "Download via the Fetch API instead of the downloads API.",
    fallbackFetch: "Retry a failed download once via a background fetch.",
    includeFetchCredentials:
      "Include applicable website cookies and browser-managed authentication in non-private extension fetches.",
    externalDownloadAllowlist:
      "Extension IDs allowed to start downloads through the external API, one per line.",
    webhookEnabled: "Send one HTTPS webhook after a non-private direct Save In save command.",
    webhookUrl: "User-selected HTTPS endpoint for save webhooks.",
    webhookIncludePageUrl: "Include the containing page URL in save webhooks.",
    webhookIncludePageTitle: "Include the containing page title in save webhooks.",
    webhookIncludeSelectionText: "Include selected text in save webhooks when available.",
    trackBrowserDownloads: "Include ordinary browser downloads in local Save In history.",
    routeBrowserDownloads:
      "Apply matching filename routing rules to ordinary browser downloads on Chrome.",
    browserDownloadFiltersEnabled:
      "Limit ordinary browser-download tracking and routing with URL filters.",
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
  } satisfies Record<SaveInOptionName, string>,

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
    webExtensionApi.storage.local
      .get([...OptionsManagement.getKeys(), PATH_TRUNCATION_MIGRATION_STORAGE_KEY])
      .then((loadedOptions) => {
        const storedOptions: Record<string, unknown> =
          loadedOptions && typeof loadedOptions === "object" && !Array.isArray(loadedOptions)
            ? loadedOptions
            : {};
        const callHook = (hook: unknown, value: unknown): unknown =>
          typeof hook === "function" ? Reflect.apply(hook, undefined, [value]) : value;
        const normalizeOption = (
          optionType: (typeof OPTION_KEYS)[number],
          stored: unknown,
        ): unknown => {
          const k = optionType.name;
          if (isContentOptionName(k)) return normalizeContentOption(k, stored);
          if (typeof stored === "undefined") return optionType.default;
          const validType =
            optionType.type === OPTION_TYPES.BOOL
              ? typeof stored === "boolean"
              : typeof stored === typeof optionType.default ||
                (typeof optionType.default === "number" &&
                  typeof stored === "string" &&
                  stored.trim() !== "" &&
                  Number.isFinite(Number(stored)));
          const validate = "validate" in optionType ? optionType.validate : undefined;
          if (
            !validType ||
            (typeof stored === "number" && !Number.isFinite(stored)) ||
            (validate && callHook(validate, stored) !== true)
          ) {
            return optionType.default;
          }
          try {
            return callHook("onLoad" in optionType ? optionType.onLoad : undefined, stored);
          } catch {
            // Profiles and imported settings can outlive their parser/migration.
            // One corrupt option must not prevent the background page from starting.
            return optionType.default;
          }
        };
        const nextOptions = Object.fromEntries(
          OptionsManagement.OPTION_KEYS.map((optionType) => [
            optionType.name,
            normalizeOption(optionType, storedOptions[optionType.name]),
          ]),
        ) as SaveInOptions;
        const shouldMigrateExclusive = storedOptions.routeExclusive === true;
        if (shouldMigrateExclusive) {
          nextOptions.routeExclusive = false;
          if (typeof storedOptions.routeHideFolderChoices !== "boolean") {
            nextOptions.routeHideFolderChoices = true;
          }
          if (typeof storedOptions.routeSkipUnmatched !== "boolean") {
            nextOptions.routeSkipUnmatched = true;
          }
        }
        const legacyAutomaticSource =
          typeof storedOptions.autoDownloadRules === "string"
            ? storedOptions.autoDownloadRules.trim()
            : "";
        const migratedAutomatic = legacyAutomaticSource
          ? migrateLegacyAutoDownloadRules(legacyAutomaticSource)
          : { routingSource: "", errors: [] };
        const existingRoutingSource =
          typeof storedOptions.filenamePatterns === "string"
            ? storedOptions.filenamePatterns.trim()
            : "";
        const migratedRoutingSource = [existingRoutingSource, migratedAutomatic.routingSource]
          .filter(Boolean)
          .join("\n\n");
        const shouldMigrateAutomatic =
          Boolean(legacyAutomaticSource) && migratedAutomatic.errors.length === 0;
        if (shouldMigrateAutomatic) {
          nextOptions.filenamePatterns = parseRules(migratedRoutingSource);
          nextOptions.autoDownloadRules = [];
        }
        const commit = () => {
          // Commit a complete snapshot only after every stored value has been
          // normalized. Keys removed by reset therefore return to their defaults,
          // and readers never observe a half-reloaded options bag.
          replaceOptions(nextOptions);
          return options;
        };

        const persistAutomaticMigration = () =>
          shouldMigrateAutomatic
            ? webExtensionApi.storage.local.set({
                filenamePatterns: migratedRoutingSource,
                autoDownloadRules: "",
              })
            : Promise.resolve();
        const persistExclusiveMigration = () =>
          shouldMigrateExclusive
            ? webExtensionApi.storage.local.set({
                routeExclusive: false,
                routeHideFolderChoices: nextOptions.routeHideFolderChoices,
                routeSkipUnmatched: nextOptions.routeSkipUnmatched,
              })
            : Promise.resolve();

        const migrationVersion = storedOptions[PATH_TRUNCATION_MIGRATION_STORAGE_KEY];
        if (
          typeof migrationVersion === "number" &&
          Number.isFinite(migrationVersion) &&
          migrationVersion >= PATH_TRUNCATION_MIGRATION_VERSION
        ) {
          const committed = commit();
          return Promise.all([persistAutomaticMigration(), persistExclusiveMigration()]).then(
            () => committed,
            () => committed,
          );
        }

        // v1 counted UTF-16 code units and could exceed byte-limited filesystems.
        // Persist the normalized value with a separate version marker so event-page
        // and service-worker restarts never reinterpret the same profile twice.
        const committed = commit();
        // The migration is idempotent: retry a failed marker write on the next
        // load instead of letting a quota/storage failure block background startup.
        return Promise.all([
          persistAutomaticMigration(),
          persistExclusiveMigration(),
          webExtensionApi.storage.local.set({
            truncateLength: nextOptions.truncateLength,
            [PATH_TRUNCATION_MIGRATION_STORAGE_KEY]: PATH_TRUNCATION_MIGRATION_VERSION,
          }),
        ]).then(
          () => committed,
          () => committed,
        );
      }),
};

// loadOptions() overlays only stored keys, so the entry seeds every default
// synchronously before initialization. Keeping this explicit also makes the
// module safe to import without mutating shared state.
export const seedOptions = () => {
  // Mutate in place so every module's live reference survives a runtime reset.
  resetOptions(defaultOptions());
  return options;
};
