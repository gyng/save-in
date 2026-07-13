import {
  SHORTCUT_TYPES,
  SHORTCUT_EXTENSIONS,
  DOWNLOAD_TYPES,
  isShortcutType,
  type ShortcutType,
} from "../shared/constants.ts";
import { Download } from "./download.ts";
import { sanitizeFilename } from "../routing/path.ts";
import { currentTab } from "../platform/current-tab.ts";

type ShortcutInfo = {
  srcUrl?: string | undefined;
  linkUrl?: string | undefined;
  pageUrl?: string | undefined;
  linkText?: string | undefined;
};

const SHORTCUT_MIME_TYPES = {
  [SHORTCUT_TYPES.HTML_REDIRECT]: "text/html",
  [SHORTCUT_TYPES.MAC]: "application/octet-stream",
  [SHORTCUT_TYPES.MAC_WEBLOC]: "application/x-apple-webloc",
  [SHORTCUT_TYPES.WINDOWS]: "application/octet-stream",
  [SHORTCUT_TYPES.FREEDESKTOP]: "application/octet-stream",
} as const satisfies Record<ShortcutType, string>;

const escapeDesktopValue = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n?|\n/g, "\\n")
    .replace(/\t/g, "\\t");

const escapeInternetShortcutUrl = (value: string): string => value.replace(/[\r\n]/g, "");

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const Shortcut = {
  makeShortcutContent: (type: string | undefined, url: string, title?: string): string => {
    switch (type) {
      case SHORTCUT_TYPES.MAC:
        return `[InternetShortcut]\nURL=${escapeInternetShortcutUrl(url)}`;
      case SHORTCUT_TYPES.WINDOWS:
        return `[InternetShortcut]\r\nURL=${escapeInternetShortcutUrl(url)}`;
      case SHORTCUT_TYPES.MAC_WEBLOC:
        return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${escapeXml(url)}</string></dict></plist>`;
      case SHORTCUT_TYPES.FREEDESKTOP: {
        const name = escapeDesktopValue(title || url);
        const safeUrl = escapeDesktopValue(url);
        return [
          "[Desktop Entry]",
          "Encoding=UTF-8",
          "Icon=text-html",
          "Type=Link",
          `Name=${name}`,
          `Title=${name}`,
          `URL=${safeUrl}`,
          "[InternetShortcut]",
          `URL=${safeUrl}`,
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
    isShortcutType(type) ? SHORTCUT_MIME_TYPES[type] : "text/plain",

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
    const shortcutExtension = isShortcutType(shortcutType) ? SHORTCUT_EXTENSIONS[shortcutType] : "";

    let shortcutFilename =
      downloadType === DOWNLOAD_TYPES.PAGE
        ? `${
            suggestedFilename ||
            (currentTab && currentTab.title) ||
            info.srcUrl ||
            info.linkUrl ||
            info.pageUrl ||
            "shortcut"
          }`
        : `${suggestedFilename || info.linkText || info.srcUrl || info.linkUrl || "shortcut"}`;

    shortcutFilename = sanitizeFilename(
      `${shortcutFilename}${shortcutExtension}`,
      maxlen,
      true,
      true,
    );

    return shortcutFilename;
  },
};
