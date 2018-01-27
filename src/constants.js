/* eslint-disable no-unused-vars */

const MEDIA_TYPES = ["image", "video", "audio"];

const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: ":sourcedomain:",
  PAGE_DOMAIN: ":pagedomain:",
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
  PAGE_TITLE: ":pagetitle:",
  LINK_TEXT: ":linktext:",
  SELECTION_TEXT: ":selectiontext:",
  NAIVE_FILENAME: ":naivefilename:",
  NAIVE_FILE_EXTENSION: ":naivefileext:",
  FILENAME: ":filename:",
  FILE_EXTENSION: ":fileext:"
};

const SHORTCUT_TYPES = {
  HTML_REDIRECT: "HTML_REDIRECT",
  MAC: "MAC",
  FREEDESKTOP: "FREEDESKTOP",
  WINDOWS: "WINDOWS"
};

const SHORTCUT_EXTENSIONS = {
  [SHORTCUT_TYPES.HTML_REDIRECT]: ".html",
  [SHORTCUT_TYPES.MAC]: ".url",
  [SHORTCUT_TYPES.FREEDESKTOP]: ".desktop",
  [SHORTCUT_TYPES.WINDOWS]: ".url"
};

const DOWNLOAD_TYPES = {
  UNKNOWN: "UNKNOWN",
  MEDIA: "MEDIA",
  LINK: "LINK",
  SELECTION: "SELECTION",
  PAGE: "PAGE",
  CLICK: "CLICK"
};

const CONFLICT_ACTION = {
  UNIQUIFY: "uniquify",
  OVERWRITE: "overwrite",
  PROMPT: "prompt"
};

const RULE_TYPES = {
  MATCHER: "MATCHER",
  CAPTURE: "CAPTURE",
  DESTINATION: "DESTINATION"
};

const MESSAGE_TYPES = {
  OPTIONS: "OPTIONS",
  OPTIONS_SCHEMA: "OPTIONS_SCHEMA",
  DOWNLOAD: "DOWNLOAD",
  DOWNLOADED: "DOWNLOADED",
  CHECK_ROUTES: "CHECK_ROUTES",
  CHECK_ROUTES_RESPONSE: "CHECK_ROUTES_RESPONSE",
  OK: "OK"
};

const PATH_SEGMENT_TYPES = {
  STRING: "STRING",
  VARIABLE: "VARIABLE",
  SEPARATOR: "SEPARATOR",
  MENU_SEPARATOR: "MENU_SEPARATOR"
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    MEDIA_TYPES,
    SPECIAL_DIRS,
    SHORTCUT_TYPES,
    SHORTCUT_EXTENSIONS,
    CONFLICT_ACTION,
    RULE_TYPES,
    MESSAGE_TYPES,
    PATH_SEGMENT_TYPES
  };
}
