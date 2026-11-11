import { isPageContentSender } from "../../../src/background/messaging/protocol.ts";

describe("page content sender attestation", () => {
  test("requires the same valid non-extension URL on the request, tab, and sender", () => {
    const pageUrl = "https://example.test/gallery";
    expect(isPageContentSender({ tab: { url: pageUrl }, url: pageUrl }, pageUrl)).toBe(true);
    expect(isPageContentSender({ tab: { url: pageUrl }, url: pageUrl }, undefined)).toBe(false);
    expect(isPageContentSender({ tab: { url: pageUrl }, url: "https://other.test" }, pageUrl)).toBe(
      false,
    );
    expect(
      isPageContentSender(
        {
          tab: { url: "chrome-extension://id/options.html" },
          url: "chrome-extension://id/options.html",
        },
        "chrome-extension://id/options.html",
      ),
    ).toBe(false);
    expect(isPageContentSender({ tab: { url: "not a url" }, url: "not a url" }, "not a url")).toBe(
      false,
    );
  });

  // Measured in both browsers: after history.pushState the page reports its
  // new address while the sender's own URL is still the loaded document's.
  test("accepts the top-level page after an in-page navigation", () => {
    const loaded = "https://example.test/gallery";
    const moved = "https://example.test/gallery/photo/7#zoom";

    expect(isPageContentSender({ tab: { url: moved }, url: loaded, frameId: 0 }, moved)).toBe(true);
    expect(isPageContentSender({ tab: { url: loaded }, url: loaded }, moved)).toBe(true);
  });

  test.each([
    [
      "a subframe",
      { tab: { url: "https://example.test/a" }, url: "https://example.test/a", frameId: 3 },
    ],
    [
      "a tab on another origin",
      { tab: { url: "https://other.test/a" }, url: "https://example.test/a" },
    ],
    [
      "a sender on another origin",
      { tab: { url: "https://example.test/a" }, url: "https://other.test/a" },
    ],
    [
      "another scheme of the same host",
      { tab: { url: "http://example.test/a" }, url: "http://example.test/a" },
    ],
    ["a sender with no URL", { tab: { url: "https://example.test/a" } }],
    ["a sender with no tab", { url: "https://example.test/a" }],
  ])("rejects %s", (_label, sender) => {
    expect(isPageContentSender(sender, "https://example.test/a")).toBe(false);
  });

  test("an origin-less page must still match exactly", () => {
    const page = "file:///home/user/gallery.html";
    expect(isPageContentSender({ tab: { url: page }, url: page }, page)).toBe(true);
    expect(
      isPageContentSender({ tab: { url: page }, url: "file:///home/user/other.html" }, page),
    ).toBe(false);
    expect(
      isPageContentSender({ tab: { url: "file:///home/user/other.html" }, url: page }, page),
    ).toBe(false);
  });
});
