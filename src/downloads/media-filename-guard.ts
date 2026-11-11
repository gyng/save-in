import { DOWNLOAD_TYPES, isMediaType } from "../shared/constants.ts";
import type { RoutingDownloadInfo } from "../routing/rule-types.ts";

// A save the browser or the content script declared as media is expected to
// produce a media file, and by default it lands without a dialog. The server
// answering that request also gets to name it (Content-Disposition, or the
// last address of a redirect), so a hostile one can answer an image request
// with `cat.jpg.exe` and have a program saved under the name it chose. For
// such a save, a server- or browser-resolved name with one of these extensions
// is not adopted; a name with one that Save In derived itself asks first.
//
// The list is short and explicit on purpose: types an operating system runs or
// installs when opened. An explicit link or page save is not a media save, so
// saving a link to an installer still keeps the installer's name.
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  "apk",
  "app",
  "bat",
  "cmd",
  "com",
  "command",
  "cpl",
  "desktop",
  "dmg",
  "exe",
  "hta",
  "jar",
  "js",
  "jse",
  "lnk",
  "msi",
  "msp",
  "pif",
  "pkg",
  "ps1",
  "reg",
  "scr",
  "sh",
  "url",
  "vbe",
  "vbs",
  "wsf",
  "wsh",
]);

// Characters a file system or shell drops or does not show: Windows strips
// trailing dots and spaces, and the filename sanitizer removes invisible
// characters, so `x.exe . `, `x.jpg      .exe` and a name with a zero-width
// character inside its extension all end up as `.exe`.
const UNSEEN_CHARACTERS = /[\p{C}\p{Z}]/gu;

const extensionOf = (filename: string): string => {
  const leaf = filename.replace(/^.*[\\/]/s, "");
  const shown = leaf.replace(UNSEEN_CHARACTERS, "").replace(/\.+$/, "");
  const dot = shown.lastIndexOf(".");
  return dot < 0 ? "" : shown.slice(dot + 1).toLowerCase();
};

type MediaDeclaration = Pick<RoutingDownloadInfo, "context" | "sourceKind" | "mediaType">;

const isDeclaredMediaSave = (info: MediaDeclaration): boolean =>
  info.context === DOWNLOAD_TYPES.MEDIA ||
  info.context === DOWNLOAD_TYPES.AUTO ||
  isMediaType(info.sourceKind) ||
  isMediaType(info.mediaType);

// True when `filename` (a name or a path; only its last component counts) would
// give a declared-media save an executable or script extension.
export const isExecutableNameForMediaSave = (
  info: MediaDeclaration,
  filename: string | null | undefined,
): boolean =>
  typeof filename === "string" &&
  isDeclaredMediaSave(info) &&
  EXECUTABLE_EXTENSIONS.has(extensionOf(filename));

export const MEDIA_NAME_REFUSED_LOG =
  "server file name not used for a media save: executable extension";
