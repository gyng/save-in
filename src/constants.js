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
  LINK_TEXT: new RegExp(":linktext:", "g")
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    MEDIA_TYPES,
    SPECIAL_DIRS
  };
}
