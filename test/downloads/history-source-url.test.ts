import { Download, makeState, SaveHistory } from "./download-flow.fixture.ts";

test("history keeps the original source URL for shortcut-backed saves", () => {
  const state = makeState({
    info: {
      url: "blob:shortcut-content",
      selectedUrl: "https://example.test/original-page",
      context: "PAGE",
    },
  });

  Download.createDownloadPlan(state);

  expect(SaveHistory.addHistoryEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "blob:shortcut-content",
      info: expect.objectContaining({ sourceUrl: "https://example.test/original-page" }),
    }),
    { privateContext: false },
  );
});
