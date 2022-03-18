import * as constants from "./constants";
import * as notification from "./notification";
import * as path from "./path";
import * as option from "./option";
import * as variable from "./variable";
import * as headers from "./headers";
import * as download from "./download";
import * as menu from "./menu";
import * as messaging from "./messaging";
import * as shortcut from "./shortcut";
import * as router from "./router";
import contentDisposition from "./vendor/content-disposition";

declare global {
  // options.js, optionsError
  interface OptionError {
    message: string;
    error: string;
    warning?: boolean;
  }

  interface Window {
    SI_DEBUG: number | boolean;

    // index.js
    init: () => void;
    reset: () => void;
    optionErrors: {
      paths: any[]; // fixme
      filenamePatterns: OptionError[];
    };

    // menu.js
    lastDownloadState: State;
  }

  // Chrome-only
  // @types/chrome;

  // index.js
  const currentTab: browser.tabs.Tab | null;

  // constants.js
  type ExtractStringPropertyNames<T> = {
    [K in keyof T]: T[K] extends string ? K : never;
  }[keyof T];

  type ValueOf<T> = T[keyof T];

  const CLICK_TYPES: typeof constants.CLICK_TYPES;
  const DOWNLOAD_TYPES: typeof constants.DOWNLOAD_TYPES;
  const MEDIA_TYPES: typeof constants.MEDIA_TYPES;
  const SPECIAL_DIRS: typeof constants.SPECIAL_DIRS;
  const SHORTCUT_TYPES: typeof constants.SHORTCUT_TYPES;
  const SHORTCUT_EXTENSIONS: keyof typeof constants.SHORTCUT_EXTENSIONS;
  const CONFLICT_ACTION: keyof typeof constants.CONFLICT_ACTION;
  const RULE_TYPES: typeof constants.RULE_TYPES;
  type RuleTypesValues = keyof typeof constants.RULE_TYPES;
  const MESSAGE_TYPES: typeof constants.MESSAGE_TYPES;
  type MessageTypesValues = keyof typeof constants.MESSAGE_TYPES;

  const PATH_SEGMENT_TYPES: typeof constants.PATH_SEGMENT_TYPES;

  // download.js
  const globalChromeState: {} | State;
  const Download: typeof download;

  // headers.js
  const CustomHeaders: typeof headers;

  // menu.js
  const lastUsedPath: null | string;
  const Menus: typeof menu;

  // notification.js
  const CustomNotification: typeof notification;
  const downloadsList: Record<string | number, browser.downloads.DownloadItem>;
  let requestedDownloadFlag: boolean | number;

  // path.js
  const Path: typeof path.Path;
  const _Path: path._Path;
  const PathSegment: path.PathSegment;

  // option.js
  const OptionsManagement: typeof option;
  type TOption = "BOOL" | "VALUE";

  type OptionTypes = {
    conflictAction: browser.downloads.FilenameConflictAction;
    contentClickToSave: boolean;
    contentClickToSaveCombo: number;
    contentClickToSaveButton: typeof CLICK_TYPES[keyof typeof CLICK_TYPES];
    debug: boolean;
    enableLastLocation: boolean;
    enableNumberedItems: boolean;
    filenamePatterns: MatcherRule[][]; // string when serialized
    keyLastUsed: string;
    keyRoot: string;
    links: boolean;
    preferLinks: boolean;
    preferLinksFilterEnabled: boolean;
    preferLinksFilter: string;
    notifyDuration: number;
    notifyOnFailure: boolean;
    notifyOnRuleMatch: boolean;
    notifyOnSuccess: boolean;
    notifyOnLinkPreferred: boolean;
    page: boolean;
    paths: string;
    prompt: boolean;
    promptIfNoExtension: boolean;
    promptOnFailure: boolean;
    promptOnShift: boolean;
    replacementChar: string;
    routeExclusive: boolean;
    routeFailurePrompt: boolean;
    selection: boolean;
    shortcutLink: boolean;
    shortcutMedia: boolean;
    shortcutPage: boolean;
    shortcutTab: boolean;
    shortcutType: typeof SHORTCUT_TYPES[keyof typeof SHORTCUT_TYPES];
    truncateLength: number;
    fetchViaContent: boolean;
    fetchViaFetch: boolean;
    tabEnabled: boolean;
    closeTabOnSave: boolean;
    setRefererHeader: boolean;
    setRefererHeaderFilter: string;
  };

  // FIXME: This doesn't constraint the values for T
  // T is widened to string | number | boolean, but we ideally have T constrainted based off N
  interface OptionDefinition<
    N extends keyof OptionTypes = keyof OptionTypes,
    T = OptionTypes[N]
  > {
    name: N;
    type: "BOOL" | "VALUE";
    fn?: null | (() => unknown);
    onSave?: (val: T) => T;
    onLoad?: (val: T) => any;
    default?: T;
  }

  const options: OptionTypes;

  interface StateInfo {
    currentTab: typeof currentTab;
    linkText?: string;
    now: Date;
    pageUrl?: string;
    selectionText?: string;
    sourceUrl?: string;
    url?: string;
    suggestedFilename: null | string;
    context: typeof DOWNLOAD_TYPES[keyof typeof DOWNLOAD_TYPES];
    menuIndex: null | string;
    comment: null | string;
    modifiers: browser.contextMenus.OnClickData["modifiers"];

    filename?: string; // state mutated and added in Download.renameAndDownload
    naiveFilename?: string; // state mutated and added in Download.renameAndDownload
    initialFilename?: string; // state mutated and added in Download.renameAndDownload
  }

  // interface StateInfoAfteDownload {};

  // menu.js
  interface State {
    path: path._Path; // renameAndDownload
    scratch: { hasExtension?: boolean };
    info: StateInfo;
    needRouteMatch?: boolean;
    route?: path._Path; // download.js, renameAndDownload
  }

  // messaging.js
  const Messaging: typeof messaging;

  type MessageOptionsResponse = {
    type: "OPTIONS";
    body: typeof options;
  };

  type Message = (
    | {
        type: "OPTIONS";
      }
    | MessageOptionsResponse
    | {
        type: "OPTIONS_SCHEMA";
        body: {
          keys: typeof OptionsManagement.OPTION_KEYS;
          types: typeof OptionsManagement.OPTION_TYPES;
        };
      }
    | { type: "GET_KEYWORDS" }
    | {
        type: "KEYWORD_LIST";
        body: {
          matchers: string[];
          variables: string[];
        };
      }
    | { type: "CHECK_ROUTES" }
    | {
        type: "CHECK_ROUTES_RESPONSE";
        body: {
          optionErrors: typeof window.optionErrors;
          routeInfo: {
            path: null | string;
            captures: any;
          };
          lastDownload: typeof window.lastDownloadState;
          interpolatedVariables: unknown;
        };
      }
    | {
        type: "DOWNLOAD";
        body:
          | { status: "OK" }
          | {
              url: string;
              info: {
                pageUrl: string;
                srcUrl: string;
                selectionText: string;
              };
              comment: any;
            };
      }
  ) & { type: MessageTypesValues };

  // router.js
  interface MatcherRule {
    name: string;
    value: string;
    type: typeof RULE_TYPES[keyof typeof RULE_TYPES];
    matcher?: (
      info: browser.menus.OnClickData & StateInfo,
      stateInfo?: Partial<StateInfo>
    ) => unknown;
  }
  const Router: typeof router;

  // shortcut.js
  const Shortcut: typeof shortcut;

  // variable.js
  const Variable: typeof variable;

  // content-disposition.js
  const getFilenameFromContentDispositionHeader: typeof contentDisposition;
}
