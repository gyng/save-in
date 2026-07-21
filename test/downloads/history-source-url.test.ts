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

test("history keeps the remaining compact inputs needed to replay routing decisions", () => {
  const state = makeState({
    info: {
      frameUrl: "https://example.test/frame",
      referrerUrl: "https://example.test/previous",
      mediaType: "image",
      sourceKind: "image",
      mime: "image/jpeg",
      sha256: "abc123",
    },
  });

  Download.createDownloadPlan(state);

  expect(vi.mocked(SaveHistory.addHistoryEntry).mock.calls.at(-1)?.[0].variables).toEqual(
    expect.objectContaining({
      frameurl: "https://example.test/frame",
      referrerurl: "https://example.test/previous",
      mediatype: "image",
      sourcekind: "image",
      mime: "image/jpeg",
      sha256: "abc123",
    }),
  );
});

test("history stores a truncated, non-fetchable form of a data: URL, never the full payload", () => {
  const dataUrl = `data:image/png;base64,${"A".repeat(4000)}`;
  const state = makeState({
    route: { finalize: () => "download" },
    routeIsFolder: false,
    info: {
      url: dataUrl,
      selectedUrl: dataUrl,
      sourceUrl: dataUrl,
      filename: dataUrl,
      initialFilename: dataUrl,
      context: "AUTO",
    },
  });

  Download.createDownloadPlan(state);

  const entry = vi.mocked(SaveHistory.addHistoryEntry).mock.calls.at(-1)![0];
  const expectedDisplay = "data:image/png;base64,…";
  // storage.local must not carry the multi-kilobyte payload; the stored form is
  // a short, plainly non-fetchable ellipsis-terminated string.
  expect(entry.url).toBe(expectedDisplay);
  expect(entry.info?.sourceUrl).toBe(expectedDisplay);
  expect(entry.variables?.sourceurl).toBe(expectedDisplay);
  expect(entry.variables?.filename).toBe(expectedDisplay);
  expect(entry.variables?.initialfilename).toBe(expectedDisplay);
  expect(entry.url!.length).toBeLessThan(dataUrl.length);
  expect(entry.url!.endsWith("…")).toBe(true);
  expect(JSON.stringify(entry)).not.toContain(dataUrl);
});

test("history keeps a manual context-menu data: save's full URL (pre-4.2 compat)", () => {
  const dataUrl = `data:image/png;base64,${"A".repeat(4000)}`;
  const state = makeState({
    info: {
      url: dataUrl,
      selectedUrl: dataUrl,
      sourceUrl: dataUrl,
      // A manual save (any non-AUTO context) predates the automatic scan's
      // truncation; silently shortening it would reinterpret an existing
      // history/export contract, so it must round-trip unchanged.
      context: "MEDIA",
    },
  });

  Download.createDownloadPlan(state);

  const entry = vi.mocked(SaveHistory.addHistoryEntry).mock.calls.at(-1)![0];
  expect(entry.url).toBe(dataUrl);
  expect(entry.info?.sourceUrl).toBe(dataUrl);
  expect(entry.variables?.sourceurl).toBe(dataUrl);
});
