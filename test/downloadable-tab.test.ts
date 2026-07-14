import { isDownloadableTab } from "../src/background/downloadable-tab.ts";

describe("isDownloadableTab", () => {
  test.each([
    "https://example.com/page",
    "http://example.com/page",
    "file:///tmp/example.txt",
    "data:text/plain,hello",
    "blob:https://example.com/id",
  ])("accepts a downloadable tab URL: %s", (url) => {
    expect(isDownloadableTab({ url })).toBe(true);
  });

  test.each(["about:config", "chrome://settings/", "edge://settings/"])(
    "rejects a browser-owned tab URL: %s",
    (url) => {
      expect(isDownloadableTab({ url })).toBe(false);
    },
  );

  test.each([{ url: "" }, { url: undefined }, {}, { url: "not a URL" }])(
    "rejects a tab without a usable URL: %j",
    (tab) => {
      expect(isDownloadableTab(tab)).toBe(false);
    },
  );
});
