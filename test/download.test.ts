import { Download } from "../src/downloads/download.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "../src/routing/filename.ts";
import { options } from "../src/config/options-data.ts";

test("extension detection regex", () => {
  const match = "abc.xyz".match(EXTENSION_REGEX);
  expect(match).not.toBeNull();
  if (!match) throw new Error("Expected extension match");
  expect(match).toHaveLength(2);
  expect(match[0]).toBe(".xyz");
  expect(match[1]).toBe("xyz");
  expect("abc.XYZ".match(EXTENSION_REGEX)).toHaveLength(2);
  expect("abcxyz".match(EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(EXTENSION_REGEX)).toBeFalsy();
  expect("abc.bananas".match(EXTENSION_REGEX)).toHaveLength(2);
  expect("abc.bananas123".match(EXTENSION_REGEX)).toBeFalsy();
  // Numeric-bearing real extensions keep their letter and still match
  expect("song.mp3".match(EXTENSION_REGEX)?.[1]).toBe("mp3");
  expect("clip.h264".match(EXTENSION_REGEX)?.[1]).toBe("h264");
  expect("a.7z".match(EXTENSION_REGEX)?.[1]).toBe("7z");
  // An all-digit trailing token is an id/version, not an extension (§8.1)
  expect("photo.12345".match(EXTENSION_REGEX)).toBeFalsy();
  expect("IMG_0001.20240607".match(EXTENSION_REGEX)).toBeFalsy();
});

describe("finalizeFullPath: MIME extension append (§8.1)", () => {
  const state = (name: string, scratch: Record<string, string> = {}) => ({
    path: { finalize: () => "dir" },
    route: { finalize: () => name },
    info: { filename: name },
    scratch,
  });

  test("appends the resolved extension when the filename has none", () => {
    expect(Download.finalizeFullPath(state("image", { mimeExtension: "jpg" }))).toBe(
      "dir/image.jpg",
    );
  });

  test("appends onto a routed/renamed filename", () => {
    expect(Download.finalizeFullPath(state("renamed", { mimeExtension: "mp4" }))).toBe(
      "dir/renamed.mp4",
    );
  });

  test("leaves a filename that already has a valid extension alone", () => {
    expect(Download.finalizeFullPath(state("image.png", { mimeExtension: "jpg" }))).toBe(
      "dir/image.png",
    );
  });

  test("appends when the trailing token is all-digits (not a real extension)", () => {
    expect(Download.finalizeFullPath(state("photo.12345", { mimeExtension: "jpg" }))).toBe(
      "dir/photo.12345.jpg",
    );
  });

  test("is a no-op when no extension was resolved", () => {
    expect(Download.finalizeFullPath(state("image", {}))).toBe("dir/image");
  });
});

describe("finalizeFullPath: folder-only route keeps the real filename (§8.1)", () => {
  beforeEach(() => {
    Object.assign(options, { replacementChar: "_" });
  });

  test("routes into the folder and keeps the download's real name", () => {
    const s = {
      path: { finalize: () => "menu" },
      route: { finalize: () => "pdfs" },
      routeIsFolder: true,
      info: { filename: "report.pdf" },
      scratch: {},
    };
    expect(Download.finalizeFullPath(s)).toBe("menu/pdfs/report.pdf");
  });

  test("a non-folder route still sets the whole name (backward-compatible)", () => {
    const s = {
      path: { finalize: () => "menu" },
      route: { finalize: () => "renamed.pdf" },
      routeIsFolder: false,
      info: { filename: "report.pdf" },
      scratch: {},
    };
    expect(Download.finalizeFullPath(s)).toBe("menu/renamed.pdf");
  });

  test("folder route still appends a MIME extension to an extensionless name", () => {
    const s = {
      path: { finalize: () => "menu" },
      route: { finalize: () => "images" },
      routeIsFolder: true,
      info: { filename: "12345" },
      scratch: { mimeExtension: "jpg" },
    };
    expect(Download.finalizeFullPath(s)).toBe("menu/images/12345.jpg");
  });
});

describe("filename from URL", () => {
  test("extracts filenames from URL", () => {
    expect(getFilenameFromUrl("https://baz.com/foo.bar")).toBe("foo.bar");
    expect(getFilenameFromUrl("ftp://baz.com/foo.bar")).toBe("foo.bar");
    expect(getFilenameFromUrl("http://baz.x/a/foo.bar")).toBe("foo.bar");
    expect(getFilenameFromUrl("https://user:pass@baz.x/a/foo.bar")).toBe("foo.bar");
  });

  test("extracts URI-encoded filenames from URL", () => {
    expect(
      getFilenameFromUrl(
        "http://a.ne.jp/foo/(ok)%20%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0.bar",
      ),
    ).toBe("(ok) シャイニング.bar");
  });

  test("keeps a literal % that is not a valid escape (no throw)", () => {
    // decodeURIComponent("50%off.jpg") throws URIError — must not abort
    expect(getFilenameFromUrl("https://x.com/50%off.jpg")).toBe("50%off.jpg");
    expect(getFilenameFromUrl("https://x.com/a/file%.jpg")).toBe("file%.jpg");
  });

  test("returns an empty string for an unparseable URL", () => {
    expect(getFilenameFromUrl("not a url")).toBe("");
  });
});

describe("filename from Content-Disposition", () => {
  test("handles basic filenames", () => {
    expect(Download.getFilenameFromContentDisposition("filename=stock-photo-230363917.jpg")).toBe(
      "stock-photo-230363917.jpg",
    );
  });

  test("handles quoted filenames", () => {
    expect(Download.getFilenameFromContentDisposition('filename="stock-photo-230363917.jpg"')).toBe(
      "stock-photo-230363917.jpg",
    );
  });

  test("handles Content-Disposition with attachment;", () => {
    expect(Download.getFilenameFromContentDisposition('attachment; filename="test.json"')).toBe(
      "test.json",
    );

    expect(Download.getFilenameFromContentDisposition("attachment; filename=test.json")).toBe(
      "test.json",
    );
  });

  test("handles multiple filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition("filename=foobar; filename=notthis.jpg"),
    ).toBe("foobar");

    expect(
      Download.getFilenameFromContentDisposition("filename=foobar; filename=notthis.jpg"),
    ).toBe("foobar");
  });

  test("handles filename*=", () => {
    expect(Download.getFilenameFromContentDisposition("filename*=foo")).toBe("foo");

    expect(Download.getFilenameFromContentDisposition('filename*="foo"')).toBe("foo");
  });

  test("handles encoded utf8 filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition('filename="シャイニング・フォース イクサ";'),
    ).toBe("シャイニング・フォース イクサ");
  });

  test("handles URI-encoded filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "filename=%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0;",
      ),
    ).toBe("シャイニング");
  });

  test("handles invalid/empty Content-Disposition filenames", () => {
    expect(Download.getFilenameFromContentDisposition('=""')).toBe(null);
    expect(Download.getFilenameFromContentDisposition("")).toBe(null);
    expect(Download.getFilenameFromContentDisposition('filename=""')).toBe(null);
    expect(Download.getFilenameFromContentDisposition("filename=")).toBe(null);
  });
});
