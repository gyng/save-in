// @vitest-environment jsdom
import { contextLinkMetadataFromEvent } from "../../src/content/context-link-metadata.ts";
import { MAX_CONTEXT_LINK_URL_LENGTH } from "../../src/shared/context-link-metadata.ts";

describe("context link metadata extraction", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("reads attributes from the enclosing link", () => {
    document.body.innerHTML =
      '<a href="/full.jpg" title=" Full size " download="original.jpg"><img></a>';
    const image = document.querySelector("img");
    if (!image) throw new Error("missing fixture image");
    const event = new MouseEvent("contextmenu", { bubbles: true });
    Object.defineProperty(event, "target", { value: image });

    expect(contextLinkMetadataFromEvent(event)).toEqual({
      href: "http://localhost/full.jpg",
      title: "Full size",
      download: "original.jpg",
    });
  });

  test("uses the composed path and rejects missing or oversized links", () => {
    document.body.innerHTML = '<a href="/shadow.jpg" title="Shadow link"></a><span></span>';
    const anchor = document.querySelector("a");
    const span = document.querySelector("span");
    if (!anchor || !span) throw new Error("missing fixture elements");
    const event = new MouseEvent("contextmenu");
    Object.defineProperty(event, "composedPath", {
      configurable: true,
      value: () => [span, anchor, document, window],
    });
    expect(contextLinkMetadataFromEvent(event)?.title).toBe("Shadow link");

    anchor.href = `https://example.test/${"x".repeat(MAX_CONTEXT_LINK_URL_LENGTH)}`;
    expect(contextLinkMetadataFromEvent(event)).toBeNull();
    Object.defineProperty(event, "composedPath", { value: () => [span, document, window] });
    expect(contextLinkMetadataFromEvent(event)).toBeNull();
  });
});
