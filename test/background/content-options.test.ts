import { CONTENT_OPTIONS_CHANGED_MESSAGE } from "../../src/config/content-options.ts";
import { broadcastContentOptions } from "../../src/background/content-options.ts";
import { browserTab, installHostProperty } from "../support/webextension-host.fixture.ts";

beforeEach(() => {
  vi.clearAllMocks();
  installHostProperty(
    browser.tabs,
    "query",
    vi.fn(() => Promise.resolve([])),
  );
  installHostProperty(
    browser.tabs,
    "sendMessage",
    vi.fn(() => Promise.resolve()),
  );
});

test("broadcasts only a small normalized content-option patch", async () => {
  vi.mocked(browser.tabs.query).mockResolvedValue([
    browserTab({ id: 7 }),
    browserTab({ id: 8 }),
    browserTab(),
  ]);
  vi.mocked(browser.tabs.sendMessage).mockRejectedValueOnce(new Error("restricted page"));

  await expect(
    broadcastContentOptions({
      contentClickToSave: true,
      contentClickToSaveLongPressMs: "501",
      autoDownloadMaxPerPage: "40",
      filenamePatterns: "sourceurl: image",
      prompt: true,
      "save-in-history": Array.from({ length: 100 }, (_, id) => ({ id })),
    }),
  ).resolves.toBeUndefined();

  expect(browser.tabs.query).toHaveBeenCalledWith({});
  expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(7, {
    type: CONTENT_OPTIONS_CHANGED_MESSAGE,
    body: {
      options: {
        contentClickToSave: true,
        contentClickToSaveLongPressMs: 501,
        autoDownloadMaxPerPage: 40,
        filenamePatterns: "sourceurl: image",
      },
    },
  });
});

test("does no tab work for unrelated config and contains a failed tab query", async () => {
  await broadcastContentOptions({ prompt: true, "save-in-history": [{ id: "ignored" }] });
  expect(browser.tabs.query).not.toHaveBeenCalled();

  vi.mocked(browser.tabs.query).mockRejectedValueOnce(new Error("browser closing"));
  await expect(broadcastContentOptions({ sourcePanelEnabled: true })).resolves.toBeUndefined();
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
});
