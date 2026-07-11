/* eslint-disable no-unused-vars */

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
  FILENAME: ":filename:",
  FILE_EXTENSION: ":fileext:",
  COUNTER: ":counter:",
  UUID: ":uuid:",
  MIME: ":mime:",
  CONTENT_TYPE: ":contenttype:",
  MIME_EXT: ":mimeext:",
  SHA256: ":sha256:",
  FINAL_URL: ":finalurl:",
  REDIRECT_URL: ":redirecturl:",
};

export const SHORTCUT_TYPES = {
  HTML_REDIRECT: "HTML_REDIRECT",
  MAC: "MAC",
  FREEDESKTOP: "FREEDESKTOP",
  WINDOWS: "WINDOWS",
};

export const SHORTCUT_EXTENSIONS = {
  [SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
  [SHORTCUT_TYPES.MAC]: ".url",
  [SHORTCUT_TYPES.FREEDESKTOP]: ".desktop",
  [SHORTCUT_TYPES.WINDOWS]: ".url",
};

export const DOWNLOAD_TYPES = {
  UNKNOWN: "UNKNOWN",
  MEDIA: "MEDIA",
  LINK: "LINK",
  SELECTION: "SELECTION",
  PAGE: "PAGE",
  CLICK: "CLICK",
  TAB: "TAB",
};

export const CONFLICT_ACTION = {
  UNIQUIFY: "uniquify",
  OVERWRITE: "overwrite",
  PROMPT: "prompt",
};

export const RULE_TYPES = {
  MATCHER: "MATCHER",
  CAPTURE: "CAPTURE",
  DESTINATION: "DESTINATION",
};

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
  WAKE_WARM: "WAKE_WARM",
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
};

export const PATH_SEGMENT_TYPES = {
  STRING: "STRING",
  VARIABLE: "VARIABLE",
  SEPARATOR: "SEPARATOR",
};

export const CLICK_TYPES = {
  LEFT_CLICK: "LEFT_CLICK",
  RIGHT_CLICK: "RIGHT_CLICK",
  MIDDLE_CLICK: "MIDDLE_CLICK",
  BACK_CLICK: "BACK_CLICK",
  FORWARD_CLICK: "FORWARD_CLICK",
};

// Characters invalid in a filename/path segment (Windows as the lowest common
// denominator). One source of truth for Path's sanitizer and option.js's
// replacementChar validator (#221). No flags — callers add `g` where needed.
// eslint-disable-next-line no-control-regex -- control chars \x00-\x1f are intentionally forbidden
export const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
