// Direct tests for the one remaining vendored file (Rob--W's
// Content-Disposition parser) and its integration with
// Download.getFilenameFromContentDisposition, which elsewhere is mocked.

import { getFilenameFromContentDispositionHeader as parse } from "../src/vendor/content-disposition.ts";

describe("vendored content-disposition parser", () => {
  test("quoted and unquoted filenames", () => {
    expect(parse('attachment; filename="cat.jpg"')).toBe("cat.jpg");
    expect(parse("attachment; filename=cat.jpg")).toBe("cat.jpg");
  });

  test("RFC 5987 filename* with UTF-8 percent-encoding", () => {
    expect(parse("attachment; filename*=UTF-8''%e2%82%ac%20rates.pdf")).toBe("€ rates.pdf");
  });

  test("filename* takes priority over filename", () => {
    expect(parse("attachment; filename=\"fallback.txt\"; filename*=UTF-8''%c3%a9tude.pdf")).toBe(
      "étude.pdf",
    );
  });

  test("invalid filename* values fall back to filename", () => {
    const invalidExtendedValues = [
      "UTF-8''",
      "UTF-8''%E2%82",
      "UTF-8''bad%ZZname.txt",
      "X-UNKNOWN''bad%20name.txt",
      "\"UTF-8''%c3%a9tude.pdf\"",
    ];

    for (const value of invalidExtendedValues) {
      expect(parse(`attachment; filename="fallback.txt"; filename*=${value}`)).toBe("fallback.txt");
    }
  });

  test("invalid filename* without a fallback is ignored", () => {
    expect(parse("attachment; filename*=foo")).toBe("");
    expect(parse('attachment; filename*="foo"')).toBe("");
  });

  test("percent escapes are decoded exactly once", () => {
    expect(parse("attachment; filename=report%20final.txt")).toBe("report final.txt");
    expect(parse("attachment; filename=report%2520final.txt")).toBe("report%20final.txt");
    expect(parse("attachment; filename*=UTF-8''report%2520final.txt")).toBe("report%20final.txt");
  });

  test("can match Firefox's native extended-value compatibility", () => {
    const firefoxCompatibility = {
      allowQuotedExtendedValue: true,
      unescapeExtendedValueAgain: true,
    };

    expect(
      parse(
        "attachment; filename=fallback.txt; filename*=\"UTF-8''quoted-%E2%82%AC.txt\"",
        firefoxCompatibility,
      ),
    ).toBe("quoted-€.txt");
    expect(
      parse("attachment; filename*=UTF-8''extended-percent%2520value.txt", firefoxCompatibility),
    ).toBe("extended-percent value.txt");
    expect(parse("attachment; filename=plain-percent%2520value.txt", firefoxCompatibility)).toBe(
      "plain-percent%20value.txt",
    );
  });

  test("latin1 charset", () => {
    expect(parse("attachment; filename*=iso-8859-1'en'caf%E9.txt")).toBe("café.txt");
  });

  test("RFC 2047 encoded words", () => {
    expect(parse('attachment; filename="=?UTF-8?Q?caf=C3=A9.txt?="')).toBe("café.txt");
  });

  test("RFC 2231 continuations", () => {
    expect(parse('attachment; filename*0="foo"; filename*1="bar.txt"')).toBe("foobar.txt");
  });

  test("ignores inherited array entries when a continuation starts after zero", () => {
    let filename: string;
    // eslint-disable-next-line no-extend-native -- deliberately simulate a polluted prototype
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      value: ["", '"polluted"'],
      writable: true,
    });
    try {
      filename = parse('attachment; filename*1="tail.txt"');
    } finally {
      delete (Array.prototype as unknown[])[0];
    }

    expect(filename).toBe("");
  });

  test("no filename yields an empty string", () => {
    expect(parse("inline")).toBe("");
  });

  test("literal % survives", () => {
    expect(parse('attachment; filename="50%.txt"')).toBe("50%.txt");
  });
});

describe("Download.getFilenameFromContentDisposition with the real parser", () => {
  let Download: typeof import("../src/downloads/download.ts").Download;

  beforeAll(async () => {
    vi.resetModules();
    (global as any).chrome = {};
    Download = (await import("../src/downloads/download.ts")).Download;
  });

  test("returns the decoded server-provided filename", () => {
    expect(
      Download.getFilenameFromContentDisposition("attachment; filename*=UTF-8''%c3%a9tude.pdf"),
    ).toBe("étude.pdf");
  });

  test("does not decode the parser result again", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "attachment; filename*=UTF-8''report%2520final.txt",
      ),
    ).toBe("report%20final.txt");
  });

  test("uses filename when filename* is invalid", () => {
    expect(
      Download.getFilenameFromContentDisposition(
        "attachment; filename=fallback.txt; filename*=UTF-8''%E2%82",
      ),
    ).toBe("fallback.txt");
  });

  test("a literal % in the filename does not throw (#double-decode fix)", () => {
    expect(Download.getFilenameFromContentDisposition('attachment; filename="50%.txt"')).toBe(
      "50%.txt",
    );
  });

  test("headers without a filename yield null", () => {
    expect(Download.getFilenameFromContentDisposition("inline")).toBe(null);
  });
});
