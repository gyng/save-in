import {
  MAX_HOVERED_SOURCE_URL_LENGTH,
  parseHoveredSource,
} from "../../src/shared/hovered-source.ts";

describe("hovered source contract", () => {
  test("keeps the media and the link the pointer is over", () => {
    expect(
      parseHoveredSource({
        media: { url: "https://example.test/a.png", kind: "image", element: {} },
        linkUrl: "https://example.test/full",
        extra: 1,
      }),
    ).toEqual({
      media: { url: "https://example.test/a.png", kind: "image" },
      linkUrl: "https://example.test/full",
    });
    expect(parseHoveredSource({ linkUrl: "ftp://example.test/file.zip" })).toEqual({
      linkUrl: "ftp://example.test/file.zip",
    });
    expect(
      parseHoveredSource({ media: { url: "blob:https://example.test/1", kind: "video" } }),
    ).toEqual({ media: { url: "blob:https://example.test/1", kind: "video" } });
    expect(
      parseHoveredSource({ media: { url: "data:audio/ogg;base64,AAAA", kind: "audio" } }),
    ).toEqual({ media: { url: "data:audio/ogg;base64,AAAA", kind: "audio" } });
  });

  test("keeps an image's bounded alt text and no other kind's", () => {
    expect(
      parseHoveredSource({
        media: { url: "https://x.test/a.png", kind: "image", alt: "  Misty forest  " },
      }),
    ).toEqual({ media: { url: "https://x.test/a.png", kind: "image", alt: "Misty forest" } });
    expect(
      parseHoveredSource({ media: { url: "https://x.test/a.png", kind: "image", alt: "   " } }),
    ).toEqual({ media: { url: "https://x.test/a.png", kind: "image" } });
    expect(
      parseHoveredSource({ media: { url: "https://x.test/v.mp4", kind: "video", alt: "clip" } }),
    ).toEqual({ media: { url: "https://x.test/v.mp4", kind: "video" } });
    expect(
      parseHoveredSource({ media: { url: "https://x.test/a.png", kind: "image", alt: 7 } }),
    ).toEqual({ media: { url: "https://x.test/a.png", kind: "image" } });
  });

  test("drops the half of an answer it cannot accept", () => {
    expect(
      parseHoveredSource({
        media: { url: "https://example.test/a.png", kind: "link" },
        linkUrl: "https://example.test/full",
      }),
    ).toEqual({ linkUrl: "https://example.test/full" });
    expect(
      parseHoveredSource({
        media: { url: "https://example.test/a.png", kind: "image" },
        linkUrl: "javascript:alert(1)",
      }),
    ).toEqual({ media: { url: "https://example.test/a.png", kind: "image" } });
  });

  test.each([
    ["no response", undefined],
    ["a null response", null],
    ["a non-record", "https://example.test/a.png"],
    ["an empty record", {}],
    ["a non-record media", { media: "https://example.test/a.png" }],
    ["media without a kind", { media: { url: "https://example.test/a.png" } }],
    ["a non-string address", { linkUrl: 7 }],
    ["an empty address", { linkUrl: "" }],
    ["a relative address", { linkUrl: "/a.png" }],
    ["a script address", { linkUrl: "javascript:alert(1)" }],
    ["an extension address", { linkUrl: "moz-extension://id/page.html" }],
    [
      "an oversized address",
      { linkUrl: `https://example.test/${"x".repeat(MAX_HOVERED_SOURCE_URL_LENGTH)}` },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseHoveredSource(value)).toBeNull();
  });
});
