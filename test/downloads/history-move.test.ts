import { configureDownloadPorts } from "../../src/downloads/ports.ts";
import { downloadsState, sessionWriteState } from "../../src/downloads/download-state-instances.ts";
import { mergeDownload } from "../../src/downloads/download-state.ts";
import { extensionSessionStorage } from "../../src/platform/storage-areas.ts";
import {
  completePendingHistoryMove,
  registerPendingHistoryMove,
} from "../../src/downloads/history-move.ts";
import type { HistoryEntry } from "../../src/shared/history-types.ts";

const history = {
  add: vi.fn(() => "new-history"),
  patch: vi.fn(async () => undefined),
  patchStrict: vi.fn<
    (id: string | null | undefined, fields: Partial<HistoryEntry>) => Promise<unknown>
  >(async () => undefined),
  setDownloadId: vi.fn(async () => undefined),
  setStatus: vi.fn(async () => undefined),
  setStatusStrict: vi.fn(async () => undefined),
  entries: vi.fn(async () => []),
  hasCompletedUrl: vi.fn(async () => false),
  anchorStartTime: vi.fn(async () => undefined),
};
const log = { add: vi.fn() };

type SearchItem = { id: number; filename?: string; startTime?: string; exists?: boolean };
// Answers downloads.search by id. Each move looks up its replacement as well
// as the original, so every test names where the replacement landed.
const serveDownloads = (...items: SearchItem[]) =>
  vi
    .mocked(global.browser.downloads.search)
    .mockImplementation((async (query: { id?: number }) =>
      items.filter((item) => item.id === query.id)) as never);
const replacementAt = (id: number, filename = "/downloads/moved/photo.png"): SearchItem => ({
  id,
  filename,
});

beforeEach(async () => {
  downloadsState.records.clear();
  downloadsState.hydration = null;
  sessionWriteState.queues.clear();
  await global.browser.storage.session.clear();
  vi.clearAllMocks();
  configureDownloadPorts({
    runtime: { debug: false },
    history,
    log,
    retry: vi.fn(async () => false),
    sourceSidecar: vi.fn(async () => undefined),
  });
  vi.mocked(global.browser.downloads.removeFile).mockResolvedValue(undefined as never);
  vi.mocked(global.browser.downloads.erase).mockResolvedValue([9] as never);
});

test("persists a pending move and completes it after an MV3 restart", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 10, {
    adopted: true,
    historyEntryId: "new-history",
  });
  await registerPendingHistoryMove(10, {
    historyId: "old-history",
    downloadId: 9,
    startTime: "2026-07-17T01:02:03.000Z",
    filename: "old/photo.png",
  });

  // Simulate worker globals dying; completion must recover the intent from
  // storage.session rather than an in-memory callback.
  downloadsState.records.clear();
  downloadsState.hydration = null;
  serveDownloads(
    { id: 9, startTime: "2026-07-17T01:02:03.000Z", filename: "/downloads/photo.png" },
    replacementAt(10),
  );

  await expect(completePendingHistoryMove(10)).resolves.toEqual({
    handled: true,
    oldRemoved: true,
    newHistoryId: "new-history",
  });
  expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(9);
  expect(history.setStatusStrict).toHaveBeenCalledWith("old-history", "moved", 9);
  expect(history.patchStrict).toHaveBeenCalledWith("new-history", { rerouteOf: "old-history" });
  expect(history.patchStrict).toHaveBeenCalledWith("old-history", { rerouteTo: "new-history" });

  downloadsState.records.clear();
  await expect(completePendingHistoryMove(10)).resolves.toEqual({
    handled: false,
    oldRemoved: false,
  });
});

test("rejects when a pending move cannot be made restart-safe", async () => {
  vi.mocked(global.browser.storage.session.set).mockRejectedValueOnce(
    new Error("session unavailable"),
  );

  await expect(
    registerPendingHistoryMove(11, {
      historyId: "old-history",
      downloadId: 9,
      filename: "old/photo.png",
    }),
  ).rejects.toThrow("session unavailable");

  expect(downloadsState.records.get(11)?.pendingHistoryMove).toMatchObject({
    historyId: "old-history",
  });
});

test("refuses to register a move for an allocated but missing replacement row", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 26, {
    adopted: true,
    historyEntryId: "missing-new-history",
  });
  history.patchStrict.mockResolvedValueOnce(false);

  await expect(
    registerPendingHistoryMove(26, {
      historyId: "old-history",
      downloadId: 25,
      filename: "old/photo.png",
    }),
  ).resolves.toBe(false);

  expect(downloadsState.records.get(26)?.pendingHistoryMove).toBeUndefined();
  expect(global.browser.storage.session.set).toHaveBeenCalledTimes(1);
});

test("refuses private no-row intent that session privacy would not persist", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 28, {
    adopted: true,
    privateContext: true,
  });
  vi.mocked(global.browser.storage.session.set).mockClear();

  await expect(
    registerPendingHistoryMove(28, {
      historyId: "old-private-history",
      downloadId: 27,
      filename: "old/private.png",
    }),
  ).resolves.toBe(false);

  expect(downloadsState.records.get(28)?.pendingHistoryMove).toBeUndefined();
  expect(global.browser.storage.session.set).not.toHaveBeenCalled();
});

test("keeps the original when its persisted identity no longer matches", async () => {
  await registerPendingHistoryMove(12, {
    historyId: "old-history",
    downloadId: 11,
    filename: "old/photo.png",
  });
  serveDownloads({ id: 11, filename: "/downloads/unrelated.pdf" }, replacementAt(12));

  await expect(completePendingHistoryMove(12)).resolves.toMatchObject({
    handled: true,
    oldRemoved: false,
  });
  expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  expect(history.setStatusStrict).not.toHaveBeenCalled();
});

test("keeps both files when the replacement History row was not persisted", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 22, {
    adopted: true,
    historyEntryId: "missing-new-history",
  });
  await registerPendingHistoryMove(22, {
    historyId: "old-history",
    downloadId: 21,
    filename: "old/photo.png",
  });
  history.patchStrict.mockResolvedValueOnce(false);

  await expect(completePendingHistoryMove(22)).resolves.toEqual({
    handled: true,
    oldRemoved: false,
  });

  expect(global.browser.downloads.search).not.toHaveBeenCalled();
  expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  expect(downloadsState.records.get(22)?.pendingHistoryMove).toBeUndefined();
});

test("removes a one-sided new-row link when the original History row disappeared", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 24, {
    adopted: true,
    historyEntryId: "new-history",
  });
  await registerPendingHistoryMove(24, {
    historyId: "missing-old-history",
    downloadId: 23,
    filename: "old/photo.png",
  });
  history.patchStrict.mockResolvedValueOnce(undefined).mockResolvedValueOnce(false);

  await expect(completePendingHistoryMove(24)).resolves.toMatchObject({
    handled: true,
    oldRemoved: false,
  });

  expect(history.patch).toHaveBeenCalledWith("new-history", { rerouteOf: undefined });
  expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  expect(downloadsState.records.get(24)?.pendingHistoryMove).toBeUndefined();
});

test("serializes concurrent completion observers for the same move", async () => {
  await registerPendingHistoryMove(14, {
    historyId: "old-history",
    downloadId: 13,
    filename: "old/photo.png",
  });
  let finishSearch!: (items: unknown[]) => void;
  const originalSearch = new Promise((resolve) => {
    finishSearch = resolve;
  });
  vi.mocked(global.browser.downloads.search).mockImplementation(((query: { id?: number }) =>
    query.id === 14 ? Promise.resolve([replacementAt(14)]) : originalSearch) as never);

  const first = completePendingHistoryMove(14);
  const second = completePendingHistoryMove(14);
  expect(second).toBe(first);
  finishSearch([{ id: 13, filename: "/downloads/photo.png" }]);

  await expect(Promise.all([first, second])).resolves.toEqual([
    expect.objectContaining({ handled: true, oldRemoved: true }),
    expect.objectContaining({ handled: true, oldRemoved: true }),
  ]);
  expect(global.browser.downloads.removeFile).toHaveBeenCalledTimes(1);
});

test("retires a failed completion task before the next observer retries it", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 16, {
    adopted: true,
    historyEntryId: "new-history",
  });
  await registerPendingHistoryMove(16, {
    historyId: "old-history",
    downloadId: 15,
    filename: "old/photo.png",
  });
  serveDownloads({ id: 15, filename: "/downloads/photo.png" }, replacementAt(16));
  history.patchStrict.mockRejectedValueOnce(new Error("history unavailable"));

  await expect(completePendingHistoryMove(16)).rejects.toThrow("history unavailable");

  await expect(completePendingHistoryMove(16)).resolves.toMatchObject({
    handled: true,
    oldRemoved: true,
  });
  expect(global.browser.downloads.removeFile).toHaveBeenCalledTimes(1);
});

test("keeps browser recovery evidence until the moved status is durable", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 18, {
    adopted: true,
    historyEntryId: "new-history",
  });
  await registerPendingHistoryMove(18, {
    historyId: "old-history",
    downloadId: 17,
    filename: "old/photo.png",
  });
  const original: SearchItem = { id: 17, filename: "/downloads/photo.png", exists: true };
  serveDownloads(original, replacementAt(18));
  vi.mocked(global.browser.downloads.removeFile).mockImplementation((async () => {
    original.exists = false;
  }) as never);
  history.setStatusStrict.mockRejectedValueOnce(new Error("history unavailable"));

  await expect(completePendingHistoryMove(18)).rejects.toThrow("history unavailable");

  expect(global.browser.downloads.removeFile).toHaveBeenCalledOnce();
  expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  expect(downloadsState.records.get(18)?.pendingHistoryMove).toBeDefined();

  await expect(completePendingHistoryMove(18)).resolves.toMatchObject({
    handled: true,
    oldRemoved: true,
  });
  expect(global.browser.downloads.removeFile).toHaveBeenCalledOnce();
  expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 17 });
  expect(history.setStatusStrict).toHaveBeenCalledTimes(2);
  expect(downloadsState.records.get(18)?.pendingHistoryMove).toBeUndefined();
});

test("finishes a private move when only browser-shelf cleanup fails", async () => {
  await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 20, {
    adopted: true,
    privateContext: true,
    historyEntryId: "new-history",
  });
  await registerPendingHistoryMove(20, {
    historyId: "old-history",
    downloadId: 19,
    filename: "old/photo.png",
  });
  serveDownloads({ id: 19, filename: "/downloads/photo.png" }, replacementAt(20));
  vi.mocked(global.browser.downloads.erase).mockRejectedValue(new Error("shelf unavailable"));

  await expect(completePendingHistoryMove(20)).resolves.toMatchObject({
    handled: true,
    oldRemoved: true,
  });

  expect(log.add).toHaveBeenCalledWith(
    "history move shelf cleanup failed",
    "Error: shelf unavailable",
    { privateContext: true },
  );
  expect(downloadsState.records.get(20)?.pendingHistoryMove).toBeUndefined();
});

describe("a replacement that landed on the original's own path", () => {
  const registerSamePathMove = async () => {
    await mergeDownload(downloadsState, sessionWriteState, extensionSessionStorage, 32, {
      adopted: true,
      historyEntryId: "new-history",
    });
    await registerPendingHistoryMove(32, {
      historyId: "old-history",
      downloadId: 31,
      startTime: "2026-07-17T01:02:03.000Z",
      filename: "photos/photo.png",
    });
  };

  test("completes the move without removing the file both rows now name", async () => {
    await registerSamePathMove();
    serveDownloads(
      { id: 31, startTime: "2026-07-17T01:02:03.000Z", filename: "/downloads/photos/photo.png" },
      replacementAt(32, "/downloads/photos/photo.png"),
    );

    await expect(completePendingHistoryMove(32)).resolves.toEqual({
      handled: true,
      oldRemoved: true,
      newHistoryId: "new-history",
    });

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    // The old row can no longer be undone into deleting the replacement: it
    // is marked moved and its browser record, not the file, is erased.
    expect(history.setStatusStrict).toHaveBeenCalledWith("old-history", "moved", 31);
    expect(global.browser.downloads.erase).toHaveBeenCalledWith({ id: 31 });
    expect(downloadsState.records.get(32)?.pendingHistoryMove).toBeUndefined();
  });

  test("removes the original when the replacement landed elsewhere", async () => {
    await registerSamePathMove();
    serveDownloads(
      { id: 31, startTime: "2026-07-17T01:02:03.000Z", filename: "/downloads/photos/photo.png" },
      replacementAt(32, "/downloads/photos/photo (1).png"),
    );

    await expect(completePendingHistoryMove(32)).resolves.toMatchObject({ oldRemoved: true });

    expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(31);
  });

  test.each([
    ["the lookup fails", () => Promise.reject(new Error("search unavailable"))],
    ["the browser no longer knows the replacement", () => Promise.resolve([])],
    ["the replacement has no filename", () => Promise.resolve([{ id: 32, filename: "" }])],
  ])("keeps both files when %s", async (_case, replacementSearch) => {
    await registerSamePathMove();
    vi.mocked(global.browser.downloads.search).mockImplementation(((query: { id?: number }) =>
      query.id === 32
        ? replacementSearch()
        : Promise.resolve([
            {
              id: 31,
              startTime: "2026-07-17T01:02:03.000Z",
              filename: "/downloads/photos/photo.png",
            },
          ])) as never);

    await expect(completePendingHistoryMove(32)).resolves.toMatchObject({
      handled: true,
      oldRemoved: false,
    });

    expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
    expect(history.setStatusStrict).not.toHaveBeenCalled();
    expect(global.browser.downloads.erase).not.toHaveBeenCalled();
  });
});
