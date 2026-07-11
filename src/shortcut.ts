import { SHORTCUT_TYPES, SHORTCUT_EXTENSIONS, DOWNLOAD_TYPES } from "./constants.ts";
import { Download } from "./download.ts";
import { Path } from "./path.ts";
import { currentTab } from "./current-tab.ts";

export const Shortcut = {
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
          `URL=${url}`,
        ].join("\n");
      }
      case SHORTCUT_TYPES.HTML_REDIRECT: {
        // JSON-encode for the JS string literal, then escape `<` as < so
        // a `</script>` inside the URL can't break out of the <script> element
        const safeUrl = JSON.stringify(url).replace(/</g, "\\u003C");
        return `
          <html>
            <head>
              <script type="text/javascript">window.location.href = ${safeUrl}</script>
            </head>
          </html>`;
      }
      default:
        return url;
    }
  },

  // The download URL's mime must match the intended extension, or browsers
  // rewrite it (e.g. .desktop/.html shortcuts saved as .txt, #161)
  mimeForType: (type) =>
    ({
      [SHORTCUT_TYPES.HTML_REDIRECT]: "text/html",
      [SHORTCUT_TYPES.MAC]: "application/octet-stream",
      [SHORTCUT_TYPES.WINDOWS]: "application/octet-stream",
      [SHORTCUT_TYPES.FREEDESKTOP]: "application/octet-stream",
    })[type] || "text/plain",

  makeShortcut: (type, url, title = currentTab && currentTab.title) =>
    Download.makeObjectUrl(
      Shortcut.makeShortcutContent(type, url, title),
      Shortcut.mimeForType(type),
    ),

  suggestShortcutFilename: (shortcutType, downloadType, info, suggestedFilename, maxlen) => {
    const shortcutExtension = SHORTCUT_EXTENSIONS[shortcutType] || "";

    let shortcutFilename =
      downloadType === DOWNLOAD_TYPES.PAGE
        ? `${
            suggestedFilename ||
            (currentTab && currentTab.title) ||
            info.srcUrl ||
            info.linkUrl ||
            info.pageUrl
          }`
        : `${suggestedFilename || info.linkText || info.srcUrl || info.linkUrl}`;

    shortcutFilename = `${Path.sanitizeFilename(
      shortcutFilename,
      maxlen - shortcutExtension.length,
    )}${shortcutExtension}`;

    return shortcutFilename;
  },
};
