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
}

// the per-download state threaded through the rename/route/download pipeline
interface DownloadState {
  path: any; // Path.Path instance
  scratch: { hasExtension?: boolean; [key: string]: unknown };
  info: StateInfo;
  needRouteMatch?: boolean;
  route?: any; // Path.Path instance
}

// constants.js
declare const SPECIAL_DIRS: Record<string, string>;
declare const RULE_TYPES: Record<string, string>;
declare const PATH_SEGMENT_TYPES: Record<string, string>;
declare const SHORTCUT_EXTENSIONS: Record<string, string>;
declare const SHORTCUT_TYPES: Record<string, string>;
declare const MESSAGE_TYPES: Record<string, string>;
declare const DOWNLOAD_TYPES: Record<string, string>;
declare const MEDIA_TYPES: string[];
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

// index.js
declare let currentTab: browser.tabs.Tab | null;

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
  renameAndDownload: (state: DownloadState) => void;
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
declare const OptionsManagement: Record<string, any>;
declare const Notification: {
  expectDownload: () => void;
  createExtensionNotification: (title: string, message?: unknown, error?: boolean) => void;
  [key: string]: any;
};
declare const Headers: Record<string, any>;
declare const Shortcut: Record<string, any>;
declare const SaveHistory: Record<string, any>;
declare const Log: Record<string, any>;
declare const SessionState: {
  get: (key: string) => Promise<Record<string, any>>;
  set: (obj: Record<string, unknown>) => Promise<unknown>;
  [key: string]: any;
};
declare let globalChromeState: DownloadState | {};

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
}

// options page helper (src/options/*.js)
declare function addClickToCopy(el: Element): void;
