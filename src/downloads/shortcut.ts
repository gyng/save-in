import {
  SHORTCUT_TYPES,
  SHORTCUT_EXTENSIONS,
  DOWNLOAD_TYPES,
  isShortcutType,
  type ShortcutType,
} from "../shared/constants.ts";
import { makeObjectUrl } from "./download.ts";
import { sanitizeFilename } from "../routing/path.ts";
import { EXTENSION_REGEX } from "../routing/filename.ts";
import { currentTab } from "../platform/current-tab.ts";
import { withUrl } from "../shared/util.ts";

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

export const sourceSidecarPath = (
  finalFullPath: string,
  shortcutType: string,
  maxlen: number,
): { directory: string; filename: string } => {
  const slash = finalFullPath.lastIndexOf("/");
  const directory = slash >= 0 ? finalFullPath.slice(0, slash) || "." : ".";
  const filename = slash >= 0 ? finalFullPath.slice(slash + 1) : finalFullPath;
  const extension = filename.match(EXTENSION_REGEX)?.[0] ?? "";
  const stem = filename.slice(0, Math.max(0, filename.length - extension.length)) || "source";
  const shortcutExtension = isShortcutType(shortcutType)
    ? SHORTCUT_EXTENSIONS[shortcutType]
    : ".url";
  return {
    directory,
    filename: sanitizeFilename(`${stem}${shortcutExtension}`, maxlen, true, true),
  };
};

// A shortcut file navigates to its address when the user opens it, outside the
// browser's own checks, so the address may only be one a browser tab could
// have been sent to by a link: a `javascript:` address would run when an HTML
// shortcut is opened, and `file://host/share` makes Windows authenticate to a
// remote host. The check lives here, not with any caller, because the address
// is page-controlled wherever it comes from. `data:` and `blob:` addresses are
// refused as well: a shortcut to one opens nothing.
const SHORTCUT_PROTOCOLS: readonly string[] = ["http:", "https:", "ftp:"];

export type ShortcutTarget = {
  // Set only for the address of a document the browser itself reports as open
  // in a tab. A page cannot choose that address the way it chooses a link's,
  // so a shortcut to a local file the user has open stays possible.
  browserDocument?: boolean;
};

const isShortcutUrl = (url: string, target: ShortcutTarget = {}): boolean =>
  withUrl(
    url,
    ({ protocol }) =>
      SHORTCUT_PROTOCOLS.includes(protocol) ||
      (target.browserDocument === true && protocol === "file:"),
    false,
  );

// Null when the address is not one a shortcut may point at.
export const makeShortcutContent = (
  type: string | undefined,
  url: string,
  title?: string,
  target: ShortcutTarget = {},
): string | null => {
  if (!isShortcutUrl(url, target)) return null;
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
};

// The download URL's mime must match the intended extension, or browsers
// rewrite it (e.g. .desktop/.html shortcuts saved as .txt, #161)
const mimeForType = (type: string | undefined): string =>
  isShortcutType(type) ? SHORTCUT_MIME_TYPES[type] : "text/plain";

export const makeShortcut = (
  type: string | undefined,
  url: string,
  title = currentTab?.title,
  target: ShortcutTarget = {},
): string | null => {
  const content = makeShortcutContent(type, url, title, target);
  return content === null ? null : makeObjectUrl(content, mimeForType(type));
};

export const suggestShortcutFilename = (
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
};
