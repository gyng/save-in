import { CONFLICT_ACTION, SHORTCUT_TYPES } from "../shared/constants.ts";
import { CONTENT_OPTION_DEFAULTS } from "./content-options.ts";

export const LEGACY_REFERER_HEADER_FILTER = "*://i.pximg.net/*";

// Keep raw defaults in a dependency-leaf module. The live options bag needs
// them synchronously, while the full schema depends on routing validators that
// already read that bag.
export const OPTION_DEFAULTS = {
  ...CONTENT_OPTION_DEFAULTS,
  conflictAction: CONFLICT_ACTION.UNIQUIFY,
  debug: false,
  enableLastLocation: true,
  recentDestinationCount: 1,
  enableNumberedItems: true,
  filenamePatterns: "",
  keyLastUsed: "e",
  keyRoot: "e",
  preferLinks: false,
  preferLinksFilterEnabled: false,
  preferLinksFilter: ".*commons.wikimedia.org/wiki/File:.*",
  notifyDuration: 7000,
  notifyOnFailure: true,
  notifyOnRuleMatch: true,
  notifyOnSuccess: true,
  notifyOnLinkPreferred: true,
  promptAssistantEnabled: false,
  page: true,
  paths: ". // (alias: Downloads)\nImages\nVideos\nAudio\nDocuments",
  prompt: false,
  promptIfNoExtension: false,
  promptOnFailure: true,
  promptOnShift: true,
  replacementChar: "_",
  routeExclusive: false,
  routeFailurePrompt: false,
  routeHideFolderChoices: false,
  routeSkipUnmatched: false,
  selection: true,
  shortcutLink: false,
  shortcutMedia: false,
  shortcutPage: false,
  shortcutTab: false,
  shortcutType: SHORTCUT_TYPES.HTML_REDIRECT,
  saveSourceSidecar: false,
  truncateLength: 240,
  // Off: this is the one option that edits a filename the user did not ask it
  // to. It fires only on a name with no extension, but "no extension" is also
  // how LICENSE, Makefile, and README are spelled, and answering it costs a HEAD
  // to the origin. Save In should not quietly rename a save, or reach for the
  // network to decide a name, until asked.
  appendMimeExtension: false,
  fetchViaFetch: false,
  fallbackFetch: true,
  includeFetchCredentials: true,
  externalDownloadAllowlist: "",
  // The tools an agent can call include reading and changing every setting, so
  // registering them is the user's decision to make rather than a consequence
  // of opening this page in a browser that happens to support WebMCP.
  webmcpEnabled: false,
  webhookEnabled: false,
  webhookUrl: "",
  // Off, so an endpoint list only ever names plaintext targets because the user
  // asked for them: the default cannot be talked into leaving encryption.
  webhookAllowInsecure: false,
  webhookIncludePageUrl: false,
  webhookIncludePageTitle: false,
  webhookIncludeSelectionText: false,
  trackBrowserDownloads: false,
  routeBrowserDownloads: false,
  browserDownloadFiltersEnabled: false,
  browserDownloadFilter: "",
  browserDownloadExcludeFilter: "",
  routeBrowserDownloadsFirefox: false,
  tabEnabled: false,
  closeTabOnSave: false,
  setRefererHeader: false,
  setRefererHeaderFilter: `${LEGACY_REFERER_HEADER_FILTER}\n*://*.mangadex.network/*`,
} as const;

export const defaultOptions = () => ({ ...OPTION_DEFAULTS });
