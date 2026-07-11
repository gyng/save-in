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
declare const SPECIAL_DIRS: Record<string, string>;
declare const RULE_TYPES: Record<string, string>;
declare const FORBIDDEN_FILENAME_CHARS: RegExp;
declare const PATH_SEGMENT_TYPES: Record<string, string>;
declare const SHORTCUT_EXTENSIONS: Record<string, string>;
declare const SHORTCUT_TYPES: Record<string, string>;
declare const MESSAGE_TYPES: Record<string, string>;
declare const DOWNLOAD_TYPES: Record<string, string>;
// Doubles as contextMenus contexts and as mediaType names, hence the intersection
declare const MEDIA_TYPES: browser.menus.ContextType[] & string[];
declare const CLICK_TYPES: Record<string, number>;
declare const CONFLICT_ACTION: Record<string, string>;
declare const OPTION_KEYS: { name: string; type: string; default?: unknown }[];
declare const OPTION_TYPES: Record<string, string>;

// chrome-detector.js
declare const BROWSERS: Record<string, string>;
declare let CURRENT_BROWSER: string;
declare let CURRENT_BROWSER_VERSION: number;
declare let BROWSER_FEATURES: {
  accessKeys?: boolean;
  multitab?: boolean;
  [key: string]: boolean | undefined;
};

// option.js — the loaded options bag; keys are option names
declare const options: {
  paths: string;
  filenamePatterns: unknown[];
  truncateLength: number;
  replacementChar: string;
  [key: string]: any;
};

// module-object globals (one per src file); refine as files opt in
declare const Path: {
  Path: any;
  PathSegment: any;
  sanitizeFilename: (filename: string, truncateLength?: number) => string;
  truncateIfLongerThan: (str: string, max: number) => string;
  [key: string]: any;
};
declare const Download: {
  EXTENSION_REGEX: RegExp;
  renameAndDownload: (state: DownloadState) => Promise<void>;
  makeObjectUrl: (text: string, mime?: string) => string;
  pendingStates: Map<string, DownloadState>;
  [key: string]: any;
};
declare const Variable: Record<string, any>;
declare const Router: Record<string, any>;
declare const Menus: {
  IDS: Record<string, any>;
  state: {
    lastUsedPath: string | null;
    lastUsedMeta: { comment?: string | null; menuIndex?: string | null } | null;
  };
  pathMappings: Record<
    string,
    { parsedDir: string; comment: string; menuIndex: string; title: string; depth: number }
  >;
  [key: string]: any;
};
declare const Messaging: Record<string, any>;
// download-state.js — the per-download record store (in-memory + storage.session)
declare const DownloadState: {
  records: Map<number, any>;
  hydration: Promise<void> | null;
  hydrate: () => Promise<void>;
  merge: (downloadId: number, partial: Record<string, any>) => Promise<void>;
  get: (downloadId: number) => Promise<any>;
  [key: string]: any;
};
// util.js — small shared helpers (withUrl, splitLines)
declare const Util: {
  withUrl: <T>(str: string, cb: (url: URL) => T, fallback?: T) => T;
  splitLines: (raw: string | null | undefined) => string[];
};
// options page: path-editor.js (used by rule-builder.js for undoable edits)
declare const PathEditor: Record<string, any>;
// options page: history-view.js — pure history-table helpers
declare const HistoryView: Record<string, any>;
// options page: options-logic.js — pure helpers extracted from options.js
declare const OptionsLogic: Record<string, any>;
declare const OptionsManagement: Record<string, any>;
// Named Notifier/RequestHeaders (not Notification/Headers) so the runtime
// globals do not shadow the platform classes of the same name
declare const Notifier: {
  expectDownload: () => void;
  createExtensionNotification: (title: string, message?: unknown, error?: boolean) => void;
  [key: string]: any;
};
declare const RequestHeaders: Record<string, any>;
declare const Shortcut: Record<string, any>;
declare const SaveHistory: Record<string, any>;
declare const Counter: {
  KEY: string;
  writeQueue: Promise<any>;
  next: () => Promise<number>;
  peek: () => Promise<number>;
  reset: () => Promise<any>;
};
declare const Log: Record<string, any>;
declare const SessionState: {
  available: () => boolean;
  get: (key: string) => Promise<Record<string, any>>;
  set: (obj: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
  update: (key: string, fn: (current: any) => any) => Promise<void>;
  queue: Promise<any>;
};
declare let globalChromeState: Partial<DownloadState>;

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
