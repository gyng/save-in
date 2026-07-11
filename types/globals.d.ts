// Shared globals for the no-bundler background scripts (see AGENTS.md:
// plain scripts in one global scope, loaded in manifest order). These
// declarations back the opt-in `// @ts-check` files checked by
// `npm run typecheck`. They are intentionally loose in places — tighten
// them as more files opt in.

interface OptionError {
  message: string;
  error: string;
  warning?: boolean;
}

// info attached to a download state in menu-click.js / messaging.js
interface StateInfo {
  currentTab?: browser.tabs.Tab | null;
  linkText?: string;
  // Set by every internal caller; optional so empty info bags typecheck
  now?: Date;
  pageUrl?: string;
  selectionText?: string;
  sourceUrl?: string;
  url?: string;
  suggestedFilename?: string | null;
  context?: string;
  menuIndex?: string | null;
  comment?: string | null;
  modifiers?: string[];
  legacyDownloadInfo?: unknown;

  // added by Download.renameAndDownload as the filename is resolved
  filename?: string;
  naiveFilename?: string;
  initialFilename?: string;

  // preview: true suppresses side-effectful variables (:counter:, :mime:,
  // :sha256:) in the options-page dry-run; counter/headPromise/contentPromise
  // cache the resolved value so every occurrence in one download shares it —
  // and the download reuses contentPromise's fetch instead of re-downloading
  preview?: boolean;
  counter?: number;
  headPromise?: Promise<{ contentType: string; finalUrl: string }>;
  contentPromise?: Promise<{ sha256: string; downloadUrl: string } | null>;
}

// the per-download state threaded through the rename/route/download pipeline
interface DownloadState {
  path: any; // Path.Path instance
  scratch: { hasExtension?: boolean; [key: string]: unknown };
  info: StateInfo;
  needRouteMatch?: boolean;
  route?: any; // Path.Path instance
  // §8.1: the route's `into:` ended with "/" — treat it as a folder and keep
  // the download's real filename
  routeIsFolder?: boolean;
}

// constants.js
declare var SPECIAL_DIRS: any;
declare var RULE_TYPES: any;
declare var FORBIDDEN_FILENAME_CHARS: any;
declare var PATH_SEGMENT_TYPES: any;
declare var SHORTCUT_EXTENSIONS: any;
declare var SHORTCUT_TYPES: any;
declare var MESSAGE_TYPES: any;
declare var DOWNLOAD_TYPES: any;
// Doubles as contextMenus contexts and as mediaType names, hence the intersection
declare var MEDIA_TYPES: any;
declare var CLICK_TYPES: any;
declare var CONFLICT_ACTION: any;
declare var OPTION_KEYS: any;
declare var OPTION_TYPES: any;

// chrome-detector.js
declare var BROWSERS: any;
declare var CURRENT_BROWSER: any;
declare var CURRENT_BROWSER_VERSION: any;
declare var BROWSER_FEATURES: any;

// option.js — the loaded options bag; keys are option names
declare var options: any;

// module-object globals (one per src file); refine as files opt in
declare var Path: any;
declare var Download: any;
declare var Variable: any;
declare var Router: any;
declare var Menus: any;
declare var Messaging: any;
// download-state.js — the per-download record store (in-memory + storage.session)
declare var DownloadState: any;
// offscreen-client.js — Chrome SW side of the offscreen document
declare var OffscreenClient: any;
// util.js — small shared helpers (withUrl, splitLines)
declare var Util: any;
// options page: path-editor.js (used by rule-builder.js for undoable edits)
declare var PathEditor: any;
// options page: history-view.js — pure history-table helpers
declare var HistoryView: any;
// options page: options-logic.js — pure helpers extracted from options.js
declare var OptionsLogic: any;
declare var OptionsManagement: any;
// Named Notifier/RequestHeaders (not Notification/Headers) so the runtime
// globals do not shadow the platform classes of the same name
declare var Notifier: any;
declare var RequestHeaders: any;
declare var Shortcut: any;
declare var SaveHistory: any;
declare var Counter: any;
declare var Log: any;
declare var SessionState: any;
declare var globalChromeState: any;

// Chrome service worker entry (src/background.js); es2022+dom lib has no
// worker globals, so declare the one we use
declare function importScripts(...urls: string[]): void;

// src/vendor/content-disposition.js
declare function getFilenameFromContentDispositionHeader(header: string): string | undefined;

// window-hosted mutable state; in the Chrome service worker `window`
// aliases `self` (src/background.js)
interface Window {
  SI_DEBUG?: boolean | number;
  ready?: Promise<unknown>;
  init: () => Promise<unknown>;
  reset: () => Promise<unknown>;
  optionErrors: {
    paths: OptionError[];
    filenamePatterns: OptionError[];
  };
  lastDownloadState?: DownloadState;
  // options page: tab-switch unsaved-changes guard (options.js)
  confirmPendingChanges?: () => void;
}

// Experimental WebMCP (Chrome origin trial) — not yet in lib.dom. Used by the
// options-page adapter in src/options/webmcp.js, which feature-detects it.
interface ModelContext {
  registerTool: (tool: any) => any;
  [k: string]: any;
}
interface Document {
  modelContext?: ModelContext;
}
interface Navigator {
  modelContext?: ModelContext;
}
