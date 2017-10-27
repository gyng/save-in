const constants = require("../src/constants.js");
const download = require("../src/download.js");

test("escapes bad filesystem characters", () => {
  expect(download.replaceFsBadChars(":stop:")).toBe("_stop_");
  expect(download.replaceFsBadChars(":date:")).toBe("_date_");
  expect(download.replaceFsBadChars('/ : * ? " < > | %')).toBe(
    "_ _ _ _ _ _ _ _ %"
  );
  expect(download.replaceFsBadChars("")).toBe("");
  expect(download.replaceFsBadChars("ok foo bar")).toBe("ok foo bar");
});

test("extension detection regex", () => {
  expect("abc.xyz".match(download.EXTENSION_REGEX)).toHaveLength(1);
  expect("abc.XYZ".match(download.EXTENSION_REGEX)).toHaveLength(1);
  expect("abcxyz".match(download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.jpg:xyz".match(download.EXTENSION_REGEX)).toBeFalsy();
  expect("abc.bananas".match(download.EXTENSION_REGEX)).toHaveLength(1);
  expect("abc.bananas123".match(download.EXTENSION_REGEX)).toBeFalsy();
});

describe("filename from URL", () => {
  test("extracts filenames from URL", () => {
    expect(download.getFilenameFromUrl("https://baz.com/foo.bar")).toBe(
      "foo.bar"
    );
    expect(download.getFilenameFromUrl("ftp://baz.com/foo.bar")).toBe(
      "foo.bar"
    );
    expect(download.getFilenameFromUrl("http://baz.x/a/foo.bar")).toBe(
      "foo.bar"
    );
    expect(
      download.getFilenameFromUrl("https://user:pass@baz.x/a/foo.bar")
    ).toBe("foo.bar");
  });

  test("extracts URI-encoded filenames from URL", () => {
    expect(
      download.getFilenameFromUrl(
        "http://a.ne.jp/foo/(ok)%20%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0.bar"
      )
    ).toBe("(ok) シャイニング.bar");
  });
});

describe("filename from Content-Disposition", () => {
  test("handles basic filenames", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename=stock-photo-230363917.jpg"
      )
    ).toBe("stock-photo-230363917.jpg");
  });

  test("handles quoted filenames", () => {
    expect(
      download.getFilenameFromContentDisposition(
        'filename="stock-photo-230363917.jpg"'
      )
    ).toBe("stock-photo-230363917.jpg");
  });

  test("handles Content-Disposition with attachment;", () => {
    expect(
      download.getFilenameFromContentDisposition(
        'attachment; filename="test.json"'
      )
    ).toBe("test.json");

    expect(
      download.getFilenameFromContentDisposition(
        "attachment; filename=test.json"
      )
    ).toBe("test.json");
  });

  test("handles multiple filenames", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename=foobar; filename=notthis.jpg"
      )
    ).toBe("foobar");

    expect(
      download.getFilenameFromContentDisposition(
        "filename=foobar; filename=notthis.jpg"
      )
    ).toBe("foobar");
  });

  test("handles filename*=", () => {
    expect(download.getFilenameFromContentDisposition("filename*=foo")).toBe(
      "foo"
    );

    expect(download.getFilenameFromContentDisposition('filename*="foo"')).toBe(
      "foo"
    );
  });

  // https://tools.ietf.org/html/rfc5987
  test("handles rfc5987", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename*=utf-8''%e2%82%ac%20exchange%20rates"
      )
    ).toBe("€ exchange rates");

    expect(
      download.getFilenameFromContentDisposition(
        "filename*=utf-8''\"%e2%82%ac%20exchange%20rates\""
      )
    ).toBe("€ exchange rates");
  });

  test("handles utf8 filenames", () => {
    const encodeUtf8 = s => unescape(encodeURIComponent(s));

    expect(
      download.getFilenameFromContentDisposition(
        encodeUtf8('filename="シャイニング・フォース イクサ";')
      )
    ).toBe("シャイニング・フォース イクサ");
  });

  test("handles URI-encoded filenames", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename=%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0;"
      )
    ).toBe("シャイニング");
  });

  test("handles invalid/empty Content-Disposition filenames", () => {
    expect(download.getFilenameFromContentDisposition('=""')).toBe(null);
    expect(download.getFilenameFromContentDisposition("")).toBe(null);
    expect(download.getFilenameFromContentDisposition('filename=""')).toBe("");
    expect(download.getFilenameFromContentDisposition("filename=")).toBe("");
  });
});

describe("variables", () => {
  const specialDirs = global.SPECIAL_DIRS;
  const url = "http://www.source.com/foobar/file.jpg";
  const info = {
    pageUrl: "http://www.example.com/foobar/"
  };

  beforeAll(() => {
    global.SPECIAL_DIRS = constants.SPECIAL_DIRS;
  });

  afterAll(() => {
    global.SPECIAL_DIRS = specialDirs;
  });

  describe("standard variables", () => {
    test("interpolates :date:", () => {
      const now = new Date();
      const ymd = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      expect(download.replaceSpecialDirs(":date:/a/b", url, info)).toBe(
        `${ymd}/a/b`
      );
    });

    test("interpolates :pagedomain:", () => {
      expect(download.replaceSpecialDirs("a/b/:pagedomain:", url, info)).toBe(
        "a/b/www.example.com"
      );
    });

    test("interpolates :sourcedomain:", () => {
      expect(
        download.replaceSpecialDirs("a/b/:sourcedomain:/c", url, info)
      ).toBe("a/b/www.source.com/c");
    });

    test("interpolates :pageurl:", () => {
      expect(download.replaceSpecialDirs("a/b/:pageurl:/c", url, info)).toBe(
        "a/b/http___www.example.com_foobar_/c"
      );
    });
  });

  describe("filename variables", () => {
    test("replaces filename regex capture groups", () => {
      const input = "lol.jpeg";
      const patterns = [
        {
          match: new RegExp("(.*)\\.(jpeg)"),
          replace: ":$1:`:$2:`$1`:pageurl:`.jpg"
        }
      ];
      const output = download.rewriteFilename(input, patterns, url, info);
      const expected = "lol`jpeg`$1`http___www.example.com_foobar_`.jpg";
      expect(output).toBe(expected);
    });
  });
});
