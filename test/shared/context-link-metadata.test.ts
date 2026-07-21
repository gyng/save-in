import {
  MAX_CONTEXT_LINK_METADATA_LENGTH,
  MAX_CONTEXT_LINK_URL_LENGTH,
  boundedContextLinkValue,
  parseContextLinkMetadata,
} from "../../src/shared/context-link-metadata.ts";

describe("context link metadata contract", () => {
  test("normalizes bounded optional values for an exact link", () => {
    expect(
      parseContextLinkMetadata(
        {
          href: "https://example.test/file",
          title: "  Full size  ",
          download: `photo-${"x".repeat(MAX_CONTEXT_LINK_METADATA_LENGTH)}`,
        },
        "https://example.test/file",
      ),
    ).toEqual({
      href: "https://example.test/file",
      title: "Full size",
      download: `photo-${"x".repeat(MAX_CONTEXT_LINK_METADATA_LENGTH)}`.slice(
        0,
        MAX_CONTEXT_LINK_METADATA_LENGTH,
      ),
    });
    expect(boundedContextLinkValue("   ")).toBeUndefined();
    expect(
      parseContextLinkMetadata(
        { href: "https://example.test/empty" },
        "https://example.test/empty",
      ),
    ).toEqual({
      href: "https://example.test/empty",
    });
    expect(
      parseContextLinkMetadata(
        { href: "https://example.test/title", title: "Title", download: "   " },
        "https://example.test/title",
      ),
    ).toEqual({ href: "https://example.test/title", title: "Title" });
    expect(
      parseContextLinkMetadata(
        { href: "https://example.test/download", title: "", download: "name.jpg" },
        "https://example.test/download",
      ),
    ).toEqual({ href: "https://example.test/download", download: "name.jpg" });
  });

  test.each([
    [{ href: "https://other.test/file" }, "https://example.test/file"],
    [{ href: "https://example.test/file", title: 7 }, "https://example.test/file"],
    [{ href: "https://example.test/file", download: false }, "https://example.test/file"],
    [null, "https://example.test/file"],
    [
      { href: "x".repeat(MAX_CONTEXT_LINK_URL_LENGTH + 1) },
      "x".repeat(MAX_CONTEXT_LINK_URL_LENGTH + 1),
    ],
  ])("rejects stale, malformed, or oversized responses", (value, expectedHref) => {
    expect(parseContextLinkMetadata(value, expectedHref)).toBeNull();
  });
});
