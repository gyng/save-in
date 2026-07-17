import { resolveClickTarget } from "../../../src/background/menu-target.ts";

function assertPresent<T>(value: T): asserts value is NonNullable<T> {
  expect(value).not.toBeNull();
  expect(value).not.toBeUndefined();
}

describe("resolveClickTarget (pure decision)", () => {
  const opts = (over: Record<string, unknown> = {}) => ({
    links: true,
    selection: true,
    page: true,
    truncateLength: 240,
    preferLinks: false,
    preferLinksFilterEnabled: false,
    preferLinksFilter: "",
    ...over,
  });

  test("a media click saves the media source", () => {
    const t = resolveClickTarget({ mediaType: "image", srcUrl: "https://x/i.png" }, opts(), null);
    expect(t).toMatchObject({
      downloadType: "MEDIA",
      url: "https://x/i.png",
      notifyLinkPreferred: false,
    });
  });

  test("media wrapped in a link keeps the source by default", () => {
    const t = resolveClickTarget(
      { mediaType: "image", srcUrl: "https://x/i.png", linkUrl: "https://x/page" },
      opts(),
      null,
    );
    expect(t).toMatchObject({ downloadType: "MEDIA", url: "https://x/i.png" });
  });

  test("preferLinks switches to the wrapping link and flags a notification", () => {
    const t = resolveClickTarget(
      { mediaType: "image", srcUrl: "https://x/i.png", linkUrl: "https://x/page" },
      opts({ preferLinks: true }),
      null,
    );
    expect(t).toMatchObject({
      downloadType: "LINK",
      url: "https://x/page",
      notifyLinkPreferred: true,
    });
  });

  test("preferLinksFilter overrides to the link on a matching page", () => {
    const t = resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://match.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example" }),
      null,
    );
    expect(t).toMatchObject({
      downloadType: "LINK",
      url: "https://x/page",
      notifyLinkPreferred: true,
    });
  });

  test("preferLinksFilter keeps the source on a non-matching page", () => {
    const t = resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://other.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example" }),
      null,
    );
    expect(t).toMatchObject({ downloadType: "MEDIA", notifyLinkPreferred: false });
  });

  test("a trailing empty filter line does not match every page", () => {
    const t = resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://any.example/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "match\\.example\n" }),
      null,
    );
    assertPresent(t);
    expect(t.downloadType).toBe("MEDIA");
  });

  test("an invalid filter pattern reports the error and keeps the source", () => {
    const t = resolveClickTarget(
      {
        mediaType: "image",
        srcUrl: "https://x/i.png",
        linkUrl: "https://x/page",
        pageUrl: "https://any/a",
      },
      opts({ preferLinksFilterEnabled: true, preferLinksFilter: "(" }),
      null,
    );
    assertPresent(t);
    expect(t.downloadType).toBe("MEDIA");
    expect(t.badPatternError).toBeInstanceOf(Error);
  });

  test("a plain link (no media) saves the link", () => {
    const t = resolveClickTarget({ linkUrl: "https://x/page" }, opts(), null);
    expect(t).toMatchObject({ downloadType: "LINK", url: "https://x/page" });
  });

  test("with links disabled a link-only click falls through to the page", () => {
    const t = resolveClickTarget(
      { linkUrl: "https://x/page", pageUrl: "https://p" },
      opts({ links: false }),
      null,
    );
    assertPresent(t);
    expect(t.downloadType).toBe("PAGE");
  });

  test("a text selection reports its text and a .selection.txt name", () => {
    const t = resolveClickTarget({ selectionText: "hello world" }, opts(), {
      title: "My Tab",
    });
    assertPresent(t);
    expect(t).toMatchObject({
      downloadType: "SELECTION",
      selectionText: "hello world",
      url: undefined,
    });
    expect(t.suggestedFilename).toBe("My Tab.selection.txt");
  });

  test("a long selection title is truncated so the suffix still fits", () => {
    const t = resolveClickTarget({ selectionText: "x" }, opts({ truncateLength: 30 }), {
      title: "a".repeat(80),
    });
    assertPresent(t);
    assertPresent(t.suggestedFilename);
    expect(t.suggestedFilename.endsWith(".selection.txt")).toBe(true);
    expect(t.suggestedFilename.length).toBeLessThanOrEqual(30);
  });

  test("a selection falls back to its text when the tab has no title", () => {
    const t = resolveClickTarget({ selectionText: "selected words" }, opts(), { id: 4 });
    expect(t?.suggestedFilename).toBe("selected words.selection.txt");
  });

  test("a page click saves the page url named after the tab title", () => {
    const t = resolveClickTarget({ pageUrl: "https://x/page" }, opts(), { title: "Title" });
    expect(t).toMatchObject({
      downloadType: "PAGE",
      url: "https://x/page",
      suggestedFilename: "Title",
    });
  });

  test("a page click falls back to the url when no tab title is known", () => {
    const t = resolveClickTarget({ pageUrl: "https://x/page" }, opts(), null);
    assertPresent(t);
    expect(t.suggestedFilename).toBe("https://x/page");
  });

  test("returns null when there is nothing downloadable", () => {
    expect(resolveClickTarget({}, opts({ page: false, selection: false }), null)).toBeNull();
  });
});
