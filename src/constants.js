/* eslint-disable no-unused-vars */

const MEDIA_TYPES = ["image", "video", "audio"];
const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: new RegExp(":sourcedomain:", "g"),
  SOURCE_URL: new RegExp(":sourceurl:", "g"),
  PAGE_DOMAIN: new RegExp(":pagedomain:", "g"),
  PAGE_URL: new RegExp(":pageurl:", "g"),
  PAGE_TITLE: new RegExp(":pagetitle:", "g"),
  DATE: new RegExp(":date:", "g"),
  ISO8601_DATE: new RegExp(":isodate:", "g"),
  UNIX_DATE: new RegExp(":unixdate:", "g"),
  FILENAME: new RegExp(":filename:", "g"),
  NAIVE_FILENAME: new RegExp(":naivefilename:", "g"),
  FILE_EXTENSION: new RegExp(":fileext:", "g"),
  NAIVE_FILE_EXTENSION: new RegExp(":naivefileext:", "g"),
  LINK_TEXT: new RegExp(":linktext:", "g"),
  YEAR: new RegExp(":year:", "g"),
  DAY: new RegExp(":day:", "g"),
  MONTH: new RegExp(":month:", "g"),
  HOUR: new RegExp(":hour:", "g"),
  MINUTE: new RegExp(":minute:", "g"),
  SECOND: new RegExp(":second:", "g"),
  SELECTION: new RegExp(":selectiontext:", "g")
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
  PAGE: "PAGE"
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

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    MEDIA_TYPES,
    SPECIAL_DIRS,
    SHORTCUT_TYPES,
    SHORTCUT_EXTENSIONS,
    CONFLICT_ACTION,
    RULE_TYPES
  };
}
