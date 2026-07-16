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

test("history stores a truncated, non-fetchable form of a data: URL, never the payload", () => {
  const dataUrl = `data:image/png;base64,${"A".repeat(4000)}`;
  const state = makeState({
    info: {
      url: dataUrl,
      selectedUrl: dataUrl,
      sourceUrl: dataUrl,
      context: "AUTO",
    },
  });

  Download.createDownloadPlan(state);

  const entry = vi.mocked(SaveHistory.addHistoryEntry).mock.calls.at(-1)![0];
  const expectedDisplay = `${dataUrl.slice(0, 100)}…`;
  // storage.local must not carry the multi-kilobyte payload; the stored form is
  // a short, plainly non-fetchable ellipsis-terminated string.
  expect(entry.url).toBe(expectedDisplay);
  expect(entry.info?.sourceUrl).toBe(expectedDisplay);
  expect(entry.variables?.sourceurl).toBe(expectedDisplay);
  expect(entry.url!.length).toBeLessThan(dataUrl.length);
  expect(entry.url!.endsWith("…")).toBe(true);
});
