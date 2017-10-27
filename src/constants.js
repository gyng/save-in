/* eslint-disable no-unused-vars */

const MEDIA_TYPES = ["image", "video", "audio"];
const SPECIAL_DIRS = {
  SEPARATOR: "---",
  SOURCE_DOMAIN: ":sourcedomain:",
  PAGE_DOMAIN: ":pagedomain:",
  PAGE_URL: ":pageurl:",
  DATE: ":date:",
  UNIX_DATE: ":unixdate:",
  FILENAME: ":filename:"
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    MEDIA_TYPES,
    SPECIAL_DIRS
  };
}
