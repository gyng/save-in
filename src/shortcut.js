const makeShortcutContent = (type, url, title) => {
  switch (type) {
    case SHORTCUT_TYPES.MAC:
      return `[InternetShortcut]\nURL=${url}`;
    case SHORTCUT_TYPES.WINDOWS:
      return `[InternetShortcut]\r\nURL=${url}`;
    case SHORTCUT_TYPES.FREEDESKTOP:
      return `[Desktop Entry]\nEncoding=UTF-8\nType=Link\nTitle=${title ||
        url}\nURL=${url}`;
    case SHORTCUT_TYPES.HTML_REDIRECT:
      return `
        <html>
          <head>
            <script type="text/javascript">window.location.href = "${url}"</script>
          </head>
        </html>`;
    default:
      return url;
  }
};

const makeShortcut = (type, url) =>
  makeObjectUrl(makeShortcutContent(type, url));

const suggestShortcutFilename = (
  shortcutType,
  downloadType,
  info,
  suggestedFilename,
  maxlen
) => {
  const shortcutExtension = SHORTCUT_EXTENSIONS[shortcutType] || "";

  let shortcutFilename =
    downloadType === DOWNLOAD_TYPES.PAGE
      ? `${suggestedFilename ||
          (currentTab && currentTab.title) ||
          info.srcUrl ||
          info.linkUrl ||
          info.pageUrl}`
      : `${suggestedFilename || info.linkText || info.srcUrl || info.linkUrl}`;

  shortcutFilename = `${sanitizeFilename(
    shortcutFilename,
    maxlen - shortcutExtension.length
  )}${shortcutExtension}`;

  return shortcutFilename;
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    makeShortcut,
    makeShortcutContent,
    suggestShortcutFilename
  };
}
