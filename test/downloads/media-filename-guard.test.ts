import {
  isExecutableNameForMediaSave,
  MEDIA_NAME_REFUSED_LOG,
} from "../../src/downloads/media-filename-guard.ts";
import { DOWNLOAD_TYPES } from "../../src/shared/constants.ts";

const media = { context: DOWNLOAD_TYPES.MEDIA };

describe("an executable name for a media save", () => {
  test.each([
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
  ])("recognizes .%s", (extension) => {
    expect(isExecutableNameForMediaSave(media, `cat.jpg.${extension}`)).toBe(true);
    expect(isExecutableNameForMediaSave(media, `cat.${extension.toUpperCase()}`)).toBe(true);
  });

  test.each([
    ["mixed case", "cat.jpg.ExE"],
    ["trailing dots", "cat.exe..."],
    ["trailing spaces", "cat.exe   "],
    ["trailing dots and spaces", "cat.exe . . "],
    ["a gap before the extension", `cat.jpg${" ".repeat(200)}.exe`],
    ["a space inside the extension", "cat.jpg. exe"],
    ["a no-break space after it", "cat.exe\u00A0"],
    ["a zero-width space inside it", "cat.e\u200Bxe"],
    ["a right-to-left override", "cat\u202Egpj.exe"],
    ["a byte order mark after it", "cat.exe\uFEFF"],
    ["a tab and a line break after it", "cat.exe\t\n"],
    ["a leading folder", "folder/sub/cat.scr"],
    ["a Windows folder", "C:\\Downloads\\cat.scr"],
    ["a dotted folder and a plain file", "folder.jpg/cat.bat"],
    ["nothing before the dot", ".exe"],
  ])("sees through %s", (_label, name) => {
    expect(isExecutableNameForMediaSave(media, name)).toBe(true);
  });

  test.each([
    ["a picture", "cat.jpg"],
    ["an executable-looking stem", "cat.exe.jpg"],
    ["an executable-looking folder", "tools.exe/cat.png"],
    ["no extension", "exe"],
    ["a word that only ends like one", "cat.execute"],
    ["a longer extension", "cat.json"],
    ["a script-adjacent type that is not on the list", "cat.html"],
    ["an empty name", ""],
    ["only dots", "..."],
  ])("leaves %s alone", (_label, name) => {
    expect(isExecutableNameForMediaSave(media, name)).toBe(false);
  });

  test.each([null, undefined])("a missing name (%s) is not executable", (name) => {
    expect(isExecutableNameForMediaSave(media, name)).toBe(false);
  });

  test.each([
    ["a media context", { context: DOWNLOAD_TYPES.MEDIA }, true],
    ["an automatic save", { context: DOWNLOAD_TYPES.AUTO }, true],
    ["a click on an image", { context: DOWNLOAD_TYPES.CLICK, mediaType: "image" }, true],
    ["a click on a video", { context: DOWNLOAD_TYPES.CLICK, mediaType: "video" }, true],
    ["a click on audio", { context: DOWNLOAD_TYPES.CLICK, mediaType: "audio" }, true],
    ["a Page Sources image", { context: DOWNLOAD_TYPES.CLICK, sourceKind: "image" }, true],
    ["a Page Sources video", { sourceKind: "video" }, true],
    ["a Page Sources audio", { sourceKind: "audio" }, true],
    // An explicit link or page save keeps whatever name the server gives it.
    ["a link save", { context: DOWNLOAD_TYPES.LINK }, false],
    ["a page save", { context: DOWNLOAD_TYPES.PAGE }, false],
    ["a tab save", { context: DOWNLOAD_TYPES.TAB }, false],
    ["a click on a link", { context: DOWNLOAD_TYPES.CLICK }, false],
    ["a Page Sources link", { context: DOWNLOAD_TYPES.CLICK, sourceKind: "link" }, false],
    ["a Page Sources document", { sourceKind: "document" }, false],
    ["a Page Sources stream", { sourceKind: "stream" }, false],
    ["an unknown media type", { mediaType: "application" }, false],
    ["nothing declared", {}, false],
  ] as const)("%s", (_label, info, expected) => {
    expect(isExecutableNameForMediaSave(info, "setup.exe")).toBe(expected);
    expect(isExecutableNameForMediaSave(info, "cat.jpg")).toBe(false);
  });

  test("the log line names no page, address, or folder", () => {
    expect(MEDIA_NAME_REFUSED_LOG).toBe(
      "server file name not used for a media save: executable extension",
    );
  });
});
