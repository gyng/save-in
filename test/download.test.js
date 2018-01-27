const constants = require("../src/constants.js");

Object.assign(global, constants);
global.options = {};
global.Download = require("../src/download.js");
global.Paths = require("../src/path.js");

const Download = global.Download;

describe("sanitisation", () => {
  test("paths", () => {
    expect(new Paths.Path(":stop:").finalize()).toBe("_stop_");
    expect(new Paths.Path(":date:").finalize()).toBe("_date_");
    expect(new Paths.Path("/:stop:/::/").finalize()).toBe("/_stop_/__/");
    expect(new Paths.Path("/:date:/dog").finalize()).toBe("/_date_/dog");
    expect(new Paths.Path("/aa/b/c").finalize()).toBe("/aa/b/c");
    expect(new Paths.Path("ab/b/c").finalize()).toBe("ab/b/c");
    expect(new Paths.Path("a\\b/c").finalize()).toBe("a/b/c");
  });

  test("filesystem characters", () => {
    expect(Paths.replaceFsBadChars('/ : * ? " < > | % ~')).toBe(
      "_ _ _ _ _ _ _ _ % ~"
    );
  });

  describe("custom replacement character", () => {
    const oldOptions = global.options;
    beforeAll(() => {
      global.options = { replacementChar: "x" };
    });

    afterAll(() => {
      global.options = oldOptions;
    });

    test("replaces invalid characters with a custom replacement character", () => {
      expect(new Paths.Path(":stop:").finalize()).toBe("xstopx");
      expect(Paths.replaceFsBadChars("/", "a")).toBe("a");
    });
  });
});

test("extension detection regex", () => {
  const match = "abc.xyz".match(Download.EXTENSION_REGEX);
  expect(match).toHaveLength(2);
  expect(match[0]).toBe(".xyz");
  expect(match[1]).toBe("xyz");
  expect("abc.XYZ".match(Download.EXTENSION_REGEX)).toHaveLength(2);
  expect("abcxyz".match(Download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(Download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(Download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.bananas".match(Download.EXTENSION_REGEX)).toHaveLength(2);
  expect("abc.bananas123".match(Download.EXTENSION_REGEX)).toBeFalsy();
});

describe("filename from URL", () => {
  test("extracts filenames from URL", () => {
    expect(Download.getFilenameFromUrl("https://baz.com/foo.bar")).toBe(
      "foo.bar"
    );
    expect(Download.getFilenameFromUrl("ftp://baz.com/foo.bar")).toBe(
      "foo.bar"
    );
    expect(Download.getFilenameFromUrl("http://baz.x/a/foo.bar")).toBe(
      "foo.bar"
    );
    expect(
      Download.getFilenameFromUrl("https://user:pass@baz.x/a/foo.bar")
    ).toBe("foo.bar");
  });

  test("extracts URI-encoded filenames from URL", () => {
    expect(
      Download.getFilenameFromUrl(
        "http://a.ne.jp/foo/(ok)%20%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0.bar"
      )
    ).toBe("(ok) シャイニング.bar");
  });
});

describe("filename from Content-Disposition", () => {
  test("handles basic filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "filename=stock-photo-230363917.jpg"
      )
    ).toBe("stock-photo-230363917.jpg");
  });

  test("handles quoted filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        'filename="stock-photo-230363917.jpg"'
      )
    ).toBe("stock-photo-230363917.jpg");
  });

  test("handles Content-Disposition with attachment;", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        'attachment; filename="test.json"'
      )
    ).toBe("test.json");

    expect(
      Download.getFilenameFromContentDisposition(
        "attachment; filename=test.json"
      )
    ).toBe("test.json");
  });

  test("handles multiple filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "filename=foobar; filename=notthis.jpg"
      )
    ).toBe("foobar");

    expect(
      Download.getFilenameFromContentDisposition(
        "filename=foobar; filename=notthis.jpg"
      )
    ).toBe("foobar");
  });

  test("handles filename*=", () => {
    expect(Download.getFilenameFromContentDisposition("filename*=foo")).toBe(
      "foo"
    );

    expect(Download.getFilenameFromContentDisposition('filename*="foo"')).toBe(
      "foo"
    );
  });

  // https://tools.ietf.org/html/rfc5987
  test("handles rfc5987", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "filename*=utf-8''%e2%82%ac%20exchange%20rates"
      )
    ).toBe("€ exchange rates");

    expect(
      Download.getFilenameFromContentDisposition(
        "filename*=utf-8''\"%e2%82%ac%20exchange%20rates\""
      )
    ).toBe("€ exchange rates");
  });

  test("handles utf8 filenames", () => {
    const encodeUtf8 = s => unescape(encodeURIComponent(s));

    expect(
      Download.getFilenameFromContentDisposition(
        encodeUtf8('filename="シャイニング・フォース イクサ";')
      )
    ).toBe("シャイニング・フォース イクサ");
  });

  test("handles URI-encoded filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "filename=%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0;"
      )
    ).toBe("シャイニング");
  });

  test("handles invalid/empty Content-Disposition filenames", () => {
    expect(Download.getFilenameFromContentDisposition('=""')).toBe(null);
    expect(Download.getFilenameFromContentDisposition("")).toBe(null);
    expect(Download.getFilenameFromContentDisposition('filename=""')).toBe("");
    expect(Download.getFilenameFromContentDisposition("filename=")).toBe("");
  });
});
