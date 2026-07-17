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
});
