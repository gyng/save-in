import { SHORTCUT_TYPES, SHORTCUT_EXTENSIONS, DOWNLOAD_TYPES } from "../shared/constants.ts";
import { Download } from "./download.ts";
import { sanitizeFilename } from "../routing/path.ts";
import { currentTab } from "../platform/current-tab.ts";

type ShortcutInfo = {
  srcUrl?: string;
  linkUrl?: string;
  pageUrl?: string;
  linkText?: string;
};

export const Shortcut = {
  makeShortcutContent: (type: string | undefined, url: string, title?: string): string => {
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
  mimeForType: (type: string | undefined): string =>
    (
      ({
        [SHORTCUT_TYPES.HTML_REDIRECT]: "text/html",
        [SHORTCUT_TYPES.MAC]: "application/octet-stream",
        [SHORTCUT_TYPES.WINDOWS]: "application/octet-stream",
        [SHORTCUT_TYPES.FREEDESKTOP]: "application/octet-stream",
      }) as Record<string, string>
    )[type || ""] || "text/plain",

  makeShortcut: (type: string | undefined, url: string, title = currentTab?.title): string =>
    Download.makeObjectUrl(
      Shortcut.makeShortcutContent(type, url, title),
      Shortcut.mimeForType(type),
    ),

  suggestShortcutFilename: (
    shortcutType: string,
    downloadType: string,
    info: ShortcutInfo,
    suggestedFilename: string | null | undefined,
    maxlen: number,
  ): string => {
    const shortcutExtension = (SHORTCUT_EXTENSIONS as Record<string, string>)[shortcutType] || "";

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

    shortcutFilename = `${sanitizeFilename(
      shortcutFilename,
      maxlen - shortcutExtension.length,
    )}${shortcutExtension}`;

    return shortcutFilename;
  },
};
