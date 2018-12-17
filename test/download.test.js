const constants = require("../src/constants.js");

Object.assign(global, constants);

const Download = require("../src/download.js");

global.Download = Download;
global.Path = require("../src/path.js");
global.getFilenameFromContentDispositionHeader = require("../src/vendor/content-disposition.js");

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

  test("handles encoded utf8 filenames", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        'filename="シャイニング・フォース イクサ";'
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
    expect(Download.getFilenameFromContentDisposition('filename=""')).toBe(
      null
    );
    expect(Download.getFilenameFromContentDisposition("filename=")).toBe(null);
  });
});
