const Shortcut = {
  makeShortcutContent: (type, url, title) => {
    switch (type) {
      case SHORTCUT_TYPES.MAC:
        return `[InternetShortcut]\nURL=${url}`;
      case SHORTCUT_TYPES.WINDOWS:
        return `[InternetShortcut]\r\nURL=${url}`;
      case SHORTCUT_TYPES.FREEDESKTOP: {
        const name = title || url;
        return [
          "[Desktop Entry]",
          "Encoding=UTF-8",
          "Icon=text-html",
          "Type=Link",
          `Name=${name}`,
          `Title=${name}`,
          `URL=${url}`,
          "[InternetShortcut]",
          `URL=${url}`
        ].join("\n");
      }
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
  },

  makeShortcut: (type, url) =>
    Downloads.makeObjectUrl(
      Shortcut.makeShortcutContent(type, url, currentTab.pageTitle)
    ),

  suggestShortcutFilename: (
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
        : `${suggestedFilename ||
            info.linkText ||
            info.srcUrl ||
            info.linkUrl}`;

    shortcutFilename = `${Paths.sanitizeFilename(
      shortcutFilename,
      maxlen - shortcutExtension.length
    )}${shortcutExtension}`;

    return shortcutFilename;
  }
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Shortcut;
}
