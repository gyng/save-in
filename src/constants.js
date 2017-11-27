/* eslint-disable no-unused-vars */

const MEDIA_TYPES = ["image", "video", "audio"];
const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: new RegExp(":sourcedomain:", "g"),
  PAGE_DOMAIN: new RegExp(":pagedomain:", "g"),
  PAGE_URL: new RegExp(":pageurl:", "g"),
  DATE: new RegExp(":date:", "g"),
  ISO8601_DATE: new RegExp(":isodate:", "g"),
  UNIX_DATE: new RegExp(":unixdate:", "g"),
  FILENAME: new RegExp(":filename:", "g"),
  FILE_EXTENSION: new RegExp(":fileext:", "g"),
  LINK_TEXT: new RegExp(":linktext:", "g"),
  YEAR: new RegExp(":year:", "g"),
  DAY: new RegExp(":day:", "g"),
  MONTH: new RegExp(":month:", "g"),
  HOUR: new RegExp(":hour:", "g"),
  MINUTE: new RegExp(":minute:", "g"),
  SECOND: new RegExp(":second:", "g")
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
  [SHORTCUT_TYPES.FREEDESKTOP]: ".url",
  [SHORTCUT_TYPES.WINDOWS]: ".url"
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    MEDIA_TYPES,
    SPECIAL_DIRS,
    SHORTCUT_TYPES,
    SHORTCUT_EXTENSIONS
  };
}
