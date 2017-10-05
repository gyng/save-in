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
  test("extracts filenames from Content-Disposition", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename=stock-photo-230363917.jpg"
      )
    ).toBe("stock-photo-230363917.jpg");

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

    expect(download.getFilenameFromContentDisposition("filename*=foo")).toBe(
      "foo"
    );

    expect(download.getFilenameFromContentDisposition('filename*="foo"')).toBe(
      "foo"
    );
  });

  test("handles unicode content-dispositions", () => {
    expect(
      download.getFilenameFromContentDisposition("filename=シャイニング・フォース イクサ;")
    ).toBe("シャイニング・フォース イクサ");

    expect(
      download.getFilenameFromContentDisposition('filename="シャイニング・フォース イクサ";')
    ).toBe("シャイニング・フォース イクサ");
  });

  test("handles URI-encoded content-dispositions", () => {
    expect(
      download.getFilenameFromContentDisposition(
        "filename=%E3%82%B7%E3%83%A3%E3%82%A4%E3%83%8B%E3%83%B3%E3%82%B0;"
      )
    ).toBe("シャイニング");
  });

  test("handles invalid Content-Dispositions", () => {
    expect(download.getFilenameFromContentDisposition('=""')).toBe(null);
    expect(download.getFilenameFromContentDisposition('filename=""')).toBe("");
    expect(download.getFilenameFromContentDisposition("filename=")).toBe("");
  });
});

describe("directory variables", () => {
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
    expect(download.replaceSpecialDirs("a/b/:sourcedomain:/c", url, info)).toBe(
      "a/b/www.source.com/c"
    );
  });

  test("interpolates :pageurl:", () => {
    expect(download.replaceSpecialDirs("a/b/:pageurl:/c", url, info)).toBe(
      "a/b/http___www.example.com_foobar_/c"
    );
  });
});
