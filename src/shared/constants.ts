export const MEDIA_TYPES = ["image", "video", "audio"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MAX_RECENT_DESTINATIONS = 5;

export const isMediaType = (value: unknown): value is MediaType =>
  typeof value === "string" && MEDIA_TYPES.some((mediaType) => mediaType === value);

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
  ISO_YEAR: ":isoyear:",
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
  MENU_PATH: ":menupath:",
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
export type ShortcutType = (typeof SHORTCUT_TYPES)[keyof typeof SHORTCUT_TYPES];

export const isShortcutType = (value: unknown): value is ShortcutType =>
  typeof value === "string" &&
  Object.values(SHORTCUT_TYPES).some((shortcutType) => shortcutType === value);

export const SHORTCUT_EXTENSIONS = {
  [SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
  [SHORTCUT_TYPES.MAC]: ".url",
  [SHORTCUT_TYPES.MAC_WEBLOC]: ".webloc",
  [SHORTCUT_TYPES.FREEDESKTOP]: ".desktop",
  [SHORTCUT_TYPES.WINDOWS]: ".url",
} as const satisfies Record<ShortcutType, string>;

// Firefox 112 moved its dangerous-extension check into the sanitizer that
// downloads.download validates a filename against (bug 1815062 /
// CVE-2023-29542) and never gave the extension API the opt-out its file-picker
// callers got, so these fail the whole download rather than being renamed.
// Confirmed against a current Firefox: .url, .desktop, .lnk, .scf and .local
// all return "filename must not contain illegal characters"; .html and .webloc
// save (#207).
const FIREFOX_REJECTED_FILENAME_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lnk",
  ".local",
  ".url",
  ".scf",
  ".desktop",
]);

// Derived, not hand-listed: a new shortcut format picks up the restriction from
// its extension instead of quietly missing it.
export const REJECTED_SHORTCUT_TYPES: ReadonlySet<ShortcutType> = new Set(
  Object.values(SHORTCUT_TYPES).filter((type) =>
    FIREFOX_REJECTED_FILENAME_EXTENSIONS.has(SHORTCUT_EXTENSIONS[type]),
  ),
);

export const DOWNLOAD_TYPES = {
  UNKNOWN: "UNKNOWN",
  AUTO: "AUTO",
  MEDIA: "MEDIA",
  LINK: "LINK",
  SELECTION: "SELECTION",
  PAGE: "PAGE",
  CLICK: "CLICK",
  TAB: "TAB",
  SIDECAR: "SIDECAR",
} as const;

// Routing context of an adopted ordinary browser download. It is not a menu
// DOWNLOAD_TYPE — no Save In surface initiates it — but rules may match it,
// so option-reachability suppression must treat it as a non-automatic entry
// point exactly like the interactive contexts above.
export const BROWSER_DOWNLOAD_CONTEXT = "browser";

export const CONFLICT_ACTION = {
  UNIQUIFY: "uniquify",
  OVERWRITE: "overwrite",
  PROMPT: "prompt",
} as const;
export type ConflictAction = (typeof CONFLICT_ACTION)[keyof typeof CONFLICT_ACTION];

export const RULE_TYPES = {
  MATCHER: "MATCHER",
  CAPTURE: "CAPTURE",
  DESTINATION: "DESTINATION",
  FETCH: "FETCH",
  RENAME: "RENAME",
} as const;
export type RuleType = (typeof RULE_TYPES)[keyof typeof RULE_TYPES];

export const MESSAGE_TYPES = {
  OPTIONS: "OPTIONS",
  OPTIONS_SCHEMA: "OPTIONS_SCHEMA",
  OPTIONS_LOADED: "OPTIONS_LOADED",
  DOWNLOAD: "DOWNLOAD",
  AUTO_DOWNLOAD_SOURCE: "AUTO_DOWNLOAD_SOURCE",
  DOWNLOADED: "DOWNLOADED",
  CHECK_ROUTES: "CHECK_ROUTES",
  CHECK_ROUTES_RESPONSE: "CHECK_ROUTES_RESPONSE",
  // Chrome offscreen document: fetch a URL and return a blob object URL (a
  // service worker has no URL.createObjectURL)
  OFFSCREEN_FETCH: "OFFSCREEN_FETCH",
  OFFSCREEN_FETCH_CANCEL: "OFFSCREEN_FETCH_CANCEL",
  OFFSCREEN_BLOB_RELEASE: "OFFSCREEN_BLOB_RELEASE",
  OFFSCREEN_PROMPT: "OFFSCREEN_PROMPT",
  WAKE_WARM: "WAKE_WARM",
  SOURCE_PANEL_READY: "SOURCE_PANEL_READY",
  SOURCE_PANEL_STATE: "SOURCE_PANEL_STATE",
  SOURCE_PANEL_COPY: "SOURCE_PANEL_COPY",
  CREATE_SOURCE_RULE: "CREATE_SOURCE_RULE",
  DIAGNOSTICS_GET: "DIAGNOSTICS_GET",
  DIAGNOSTICS_CLEAR_FAILURES: "DIAGNOSTICS_CLEAR_FAILURES",
  HISTORY_GET: "HISTORY_GET",
  HISTORY_CLEAR: "HISTORY_CLEAR",
  HISTORY_CANCEL: "HISTORY_CANCEL",
  HISTORY_UNDO: "HISTORY_UNDO",
  HISTORY_REROUTE: "HISTORY_REROUTE",
  EXTERNAL_DOWNLOAD_REJECTIONS_GET: "EXTERNAL_DOWNLOAD_REJECTIONS_GET",
  EXTERNAL_DOWNLOAD_REJECTION_CLEAR: "EXTERNAL_DOWNLOAD_REJECTION_CLEAR",
  // External DOWNLOAD API handshake (see docs/integrating/INTEGRATIONS.md)
  PING: "PING",
  PONG: "PONG",
  // Scriptable / AI-assisted configuration API (docs/integrating/INTEGRATIONS.md §4)
  GET_SCHEMA: "GET_SCHEMA",
  SCHEMA: "SCHEMA",
  GET_CONFIG: "GET_CONFIG",
  CONFIG: "CONFIG",
  VALIDATE: "VALIDATE",
  VALIDATE_RESULT: "VALIDATE_RESULT",
  APPLY_CONFIG: "APPLY_CONFIG",
  APPLY_CONFIG_RESULT: "APPLY_CONFIG_RESULT",
  OK: "OK",
  ERROR: "ERROR",
  GET_KEYWORDS: "GET_KEYWORDS",
  KEYWORD_LIST: "KEYWORD_LIST",
  GET_GRAMMARS: "GET_GRAMMARS",
  GRAMMAR_LIST: "GRAMMAR_LIST",
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
export type ClickType = (typeof CLICK_TYPES)[keyof typeof CLICK_TYPES];

// Characters invalid in a filename/path segment (Windows as the lowest common
// denominator). One source of truth for Path's sanitizer and the option schema's
// replacementChar validator. No flags — callers add `g` where needed.
// eslint-disable-next-line no-control-regex -- control chars \x00-\x1f are intentionally forbidden
export const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

// Format controls and variation selectors are legal on some filesystems but
// can make downloads fail or produce deceptive/inaccessible names in browser
// filename APIs (#220). The surrogate-pair alternative covers two supplemental
// blocks that share a high surrogate, without requiring mutable RegExp flags:
// the tags block (U+E0000-U+E007F, \udc00-\udc7f), whose characters render as
// nothing and can hide text inside an innocuous-looking server filename, and
// the variation selectors (U+E0100-U+E01EF, \udd00-\uddef).
export const UNSAFE_INVISIBLE_FILENAME_CHARS =
  // eslint-disable-next-line no-misleading-character-class -- combining variation selectors are intentionally matched as code points
  /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufe00-\ufe0f]|\udb40[\udc00-\udc7f\udd00-\uddef]/;
