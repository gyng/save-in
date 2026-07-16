import * as Download from "../../src/downloads/download-disposition.ts";
import { EXTENSION_REGEX, getFilenameFromUrl } from "../../src/routing/filename.ts";
import { options } from "../../src/config/options-data.ts";
import { Path } from "../../src/routing/path.ts";

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
  expect("abc.bananas123".match(EXTENSION_REGEX)?.[1]).toBe("bananas123");
  expect("app.webmanifest".match(EXTENSION_REGEX)?.[1]).toBe("webmanifest");
  expect("archive.数据".match(EXTENSION_REGEX)?.[1]).toBe("数据");
  // Numeric and punctuation-bearing suffixes are extensions under the broad
  // filename contract.
  expect("song.mp3".match(EXTENSION_REGEX)?.[1]).toBe("mp3");
  expect("clip.h264".match(EXTENSION_REGEX)?.[1]).toBe("h264");
  expect("a.7z".match(EXTENSION_REGEX)?.[1]).toBe("7z");
  expect("source.c++".match(EXTENSION_REGEX)?.[1]).toBe("c++");
  expect("photo.12345".match(EXTENSION_REGEX)?.[1]).toBe("12345");
  expect("IMG_0001.20240607".match(EXTENSION_REGEX)?.[1]).toBe("20240607");
  expect("abc.jpg?download=1".match(EXTENSION_REGEX)).toBeFalsy();
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

  test("does not append when the existing extension is all digits", () => {
    expect(Download.finalizeFullPath(state("photo.12345", { mimeExtension: "jpg" }))).toBe(
      "dir/photo.12345",
    );
  });

  test("does not append onto an existing long extension", () => {
    expect(Download.finalizeFullPath(state("app.webmanifest", { mimeExtension: "json" }))).toBe(
      "dir/app.webmanifest",
    );
  });

  test("is a no-op when no extension was resolved", () => {
    expect(Download.finalizeFullPath(state("image", {}))).toBe("dir/image");
  });

  test("budgets a MIME-derived extension inside the component byte limit", () => {
    const previous = options.truncateLength;
    options.truncateLength = 12;
    try {
      expect(Download.finalizeFullPath(state("123456789012", { mimeExtension: "jpg" }))).toBe(
        "dir/12345678.jpg",
      );
    } finally {
      options.truncateLength = previous;
    }
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

  test("preserves the extension of a byte-limited full-name route", () => {
    const previous = options.truncateLength;
    options.truncateLength = 8;
    try {
      const s = {
        path: new Path("menu"),
        route: new Path("renamed/界界界.txt"),
        routeIsFolder: false,
        info: { filename: "report.pdf" },
        scratch: {},
      };
      expect(Download.finalizeFullPath(s)).toBe("menu/renamed/界.txt");
    } finally {
      options.truncateLength = previous;
    }
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

  test("truncates a server-resolved filename by bytes and preserves its extension", () => {
    const previous = options.truncateLength;
    options.truncateLength = 12;
    try {
      const s = {
        path: { finalize: () => "menu" },
        info: { filename: "界界界界.txt" },
        scratch: {},
      };
      expect(Download.finalizeFullPath(s)).toBe("menu/界界.txt");
    } finally {
      options.truncateLength = previous;
    }
  });

  test.each([
    { route: undefined, routeIsFolder: undefined, expected: "menu/nested_report.pdf" },
    {
      route: { finalize: () => "pdfs" },
      routeIsFolder: true,
      expected: "menu/pdfs/nested_report.pdf",
    },
  ])("keeps an untrusted filename inside one component", ({ route, routeIsFolder, expected }) => {
    const s = {
      path: { finalize: () => "menu" },
      route,
      routeIsFolder,
      info: { filename: getFilenameFromUrl("https://example.com/nested%2Freport.pdf") },
      scratch: {},
    };

    expect(Download.finalizeFullPath(s)).toBe(expected);
  });

  test("does not turn a fully deleted unlimited filename into a directory-only path", () => {
    const previous = {
      replacementChar: options.replacementChar,
      truncateLength: options.truncateLength,
    };
    Object.assign(options, { replacementChar: "", truncateLength: 0 });
    try {
      const s = {
        path: { finalize: () => "menu" },
        info: { filename: ":" },
        scratch: {},
      };

      expect(Download.finalizeFullPath(s)).toBe("menu/_");
    } finally {
      Object.assign(options, previous);
    }
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
    expect(Download.getFilenameFromContentDisposition("filename*=UTF-8''foo")).toBe("foo");
    expect(Download.getFilenameFromContentDisposition("filename*=foo")).toBe(null);
    expect(Download.getFilenameFromContentDisposition('filename*="foo"')).toBe(null);
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
