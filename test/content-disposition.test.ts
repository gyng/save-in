// Direct tests for the one remaining vendored file (Rob--W's
// Content-Disposition parser) and its integration with
// Download.getFilenameFromContentDisposition, which elsewhere is mocked.

import * as constants from "../src/shared/constants.ts";
import { getFilenameFromContentDispositionHeader as parse } from "../src/vendor/content-disposition.ts";

Object.assign(global, constants);

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

  test("latin1 charset", () => {
    expect(parse("attachment; filename*=iso-8859-1'en'caf%E9.txt")).toBe("café.txt");
  });

  test("RFC 2047 encoded words", () => {
    expect(parse('attachment; filename="=?UTF-8?Q?caf=C3=A9.txt?="')).toBe("café.txt");
  });

  test("RFC 2231 continuations", () => {
    expect(parse('attachment; filename*0="foo"; filename*1="bar.txt"')).toBe("foobar.txt");
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

  test("a literal % in the filename does not throw (#double-decode fix)", () => {
    expect(Download.getFilenameFromContentDisposition('attachment; filename="50%.txt"')).toBe(
      "50%.txt",
    );
  });

  test("headers without a filename yield null", () => {
    expect(Download.getFilenameFromContentDisposition("inline")).toBe(null);
  });
});
