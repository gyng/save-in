export const MEDIA_TYPES = ["image", "video", "audio"];

export const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: ":sourcedomain:",
  PAGE_DOMAIN: ":pagedomain:",
  SOURCE_ROOT_DOMAIN: ":sourcerootdomain:",
  PAGE_ROOT_DOMAIN: ":pagerootdomain:",
  PAGE_URL: ":pageurl:",
  SOURCE_URL: ":sourceurl:",
  DATE: ":date:",
  ISO8601_DATE: ":isodate:",
  UNIX_DATE: ":unixdate:",
  YEAR: ":year:",
  MONTH: ":month:",
  DAY: ":day:",
  HOUR: ":hour:",
  MINUTE: ":minute:",
  SECOND: ":second:",
  WEEKDAY: ":weekday:",
  MONTH_NAME: ":monthname:",
  AM_PM: ":ampm:",
  ISO_WEEK: ":isoweek:",
  WEEK: ":week:",
  PAGE_TITLE: ":pagetitle:",
  PAGE_TITLE_SLUG: ":pagetitleslug:",
  PAGE_TITLE_SNAKE: ":pagetitlesnake:",
  SOURCE_PATH: ":sourcepath:",
  TLD: ":tld:",
  LINK_TEXT: ":linktext:",
  SELECTION_TEXT: ":selectiontext:",
  NAIVE_FILENAME: ":naivefilename:",
  NAIVE_FILE_EXTENSION: ":naivefileext:",
  URL_FILE_EXTENSION: ":urlfileext:",
  FILENAME: ":filename:",
  FILE_EXTENSION: ":fileext:",
  ACTUAL_FILE_EXTENSION: ":actualfileext:",
  COUNTER: ":counter:",
  UUID: ":uuid:",
  MIME: ":mime:",
  CONTENT_TYPE: ":contenttype:",
  MIME_EXT: ":mimeext:",
  SHA256: ":sha256:",
  SHA256_FULL: ":sha256full:",
  FINAL_URL: ":finalurl:",
  REDIRECT_URL: ":redirecturl:",
} as const;

export const SHORTCUT_TYPES = {
  HTML_REDIRECT: "HTML_REDIRECT",
  MAC: "MAC",
  MAC_WEBLOC: "MAC_WEBLOC",
  FREEDESKTOP: "FREEDESKTOP",
  WINDOWS: "WINDOWS",
} as const;

export const SHORTCUT_EXTENSIONS = {
  [SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
  [SHORTCUT_TYPES.MAC]: ".url",
  [SHORTCUT_TYPES.MAC_WEBLOC]: ".webloc",
  [SHORTCUT_TYPES.FREEDESKTOP]: ".desktop",
  [SHORTCUT_TYPES.WINDOWS]: ".url",
} as const;

export const DOWNLOAD_TYPES = {
  UNKNOWN: "UNKNOWN",
  MEDIA: "MEDIA",
  LINK: "LINK",
  SELECTION: "SELECTION",
  PAGE: "PAGE",
  CLICK: "CLICK",
  TAB: "TAB",
} as const;

export const CONFLICT_ACTION = {
  UNIQUIFY: "uniquify",
  OVERWRITE: "overwrite",
  PROMPT: "prompt",
} as const;

export const RULE_TYPES = {
  MATCHER: "MATCHER",
  CAPTURE: "CAPTURE",
  DESTINATION: "DESTINATION",
} as const;

export const MESSAGE_TYPES = {
  OPTIONS: "OPTIONS",
  OPTIONS_SCHEMA: "OPTIONS_SCHEMA",
  OPTIONS_LOADED: "OPTIONS_LOADED",
  DOWNLOAD: "DOWNLOAD",
  DOWNLOADED: "DOWNLOADED",
  CHECK_ROUTES: "CHECK_ROUTES",
  CHECK_ROUTES_RESPONSE: "CHECK_ROUTES_RESPONSE",
  // Chrome offscreen document: fetch a URL and return a blob object URL (a
  // service worker has no URL.createObjectURL)
  OFFSCREEN_FETCH: "OFFSCREEN_FETCH",
  OFFSCREEN_FETCH_CANCEL: "OFFSCREEN_FETCH_CANCEL",
  OFFSCREEN_BLOB_RELEASE: "OFFSCREEN_BLOB_RELEASE",
  WAKE_WARM: "WAKE_WARM",
  SOURCE_PANEL_READY: "SOURCE_PANEL_READY",
  SOURCE_PANEL_STATE: "SOURCE_PANEL_STATE",
  SOURCE_PANEL_COPY: "SOURCE_PANEL_COPY",
  HISTORY_GET: "HISTORY_GET",
  HISTORY_CLEAR: "HISTORY_CLEAR",
  HISTORY_CANCEL: "HISTORY_CANCEL",
  EXTERNAL_DOWNLOAD_REJECTIONS_GET: "EXTERNAL_DOWNLOAD_REJECTIONS_GET",
  EXTERNAL_DOWNLOAD_REJECTION_CLEAR: "EXTERNAL_DOWNLOAD_REJECTION_CLEAR",
  // External DOWNLOAD API handshake (see docs/INTEGRATIONS.md)
  PING: "PING",
  PONG: "PONG",
  // Scriptable / AI-assisted configuration API (docs/INTEGRATIONS.md §4)
  GET_SCHEMA: "GET_SCHEMA",
  SCHEMA: "SCHEMA",
  VALIDATE: "VALIDATE",
  VALIDATE_RESULT: "VALIDATE_RESULT",
  APPLY_CONFIG: "APPLY_CONFIG",
  APPLY_CONFIG_RESULT: "APPLY_CONFIG_RESULT",
  OK: "OK",
  ERROR: "ERROR",
  GET_KEYWORDS: "GET_KEYWORDS",
  KEYWORD_LIST: "KEYWORD_LIST",
  PREVIEW_MENUS: "PREVIEW_MENUS",
  MENU_PREVIEW: "MENU_PREVIEW",
} as const;

export const PATH_SEGMENT_TYPES = {
  STRING: "STRING",
  VARIABLE: "VARIABLE",
  SEPARATOR: "SEPARATOR",
} as const;

export const CLICK_TYPES = {
  LEFT_CLICK: "LEFT_CLICK",
  RIGHT_CLICK: "RIGHT_CLICK",
  MIDDLE_CLICK: "MIDDLE_CLICK",
  BACK_CLICK: "BACK_CLICK",
  FORWARD_CLICK: "FORWARD_CLICK",
} as const;

export type SpecialDirectory = (typeof SPECIAL_DIRS)[keyof typeof SPECIAL_DIRS];
export type ShortcutType = (typeof SHORTCUT_TYPES)[keyof typeof SHORTCUT_TYPES];
export type DownloadType = (typeof DOWNLOAD_TYPES)[keyof typeof DOWNLOAD_TYPES];
export type ConflictAction = (typeof CONFLICT_ACTION)[keyof typeof CONFLICT_ACTION];
export type RuleType = (typeof RULE_TYPES)[keyof typeof RULE_TYPES];
export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
export type PathSegmentType = (typeof PATH_SEGMENT_TYPES)[keyof typeof PATH_SEGMENT_TYPES];
export type ClickType = (typeof CLICK_TYPES)[keyof typeof CLICK_TYPES];

// Characters invalid in a filename/path segment (Windows as the lowest common
// denominator). One source of truth for Path's sanitizer and option.js's
// replacementChar validator (#221). No flags — callers add `g` where needed.
// eslint-disable-next-line no-control-regex -- control chars \x00-\x1f are intentionally forbidden
export const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
