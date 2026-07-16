import { configureDownloadPorts } from "../../src/downloads/ports.ts";
import { downloadsState, sessionWriteState } from "../../src/downloads/download-state-instances.ts";
import { mergeDownload } from "../../src/downloads/download-state.ts";
import { extensionSessionStorage } from "../../src/platform/storage-areas.ts";
import {
  completePendingHistoryMove,
  registerPendingHistoryMove,
} from "../../src/downloads/history-move.ts";

const history = {
  add: vi.fn(() => "new-history"),
  patch: vi.fn(async () => undefined),
  setDownloadId: vi.fn(async () => undefined),
  setStatus: vi.fn(async () => undefined),
  entries: vi.fn(async () => []),
  anchorStartTime: vi.fn(async () => undefined),
};

beforeEach(async () => {
  downloadsState.records.clear();
  downloadsState.hydration = null;
  sessionWriteState.queues.clear();
  await global.browser.storage.session.clear();
  vi.clearAllMocks();
  configureDownloadPorts({
    runtime: { debug: false },
    history,
    log: { add: vi.fn() },
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
  vi.mocked(global.browser.downloads.search).mockResolvedValue([
    {
      id: 9,
      startTime: "2026-07-17T01:02:03.000Z",
      filename: "/downloads/photo.png",
    } as never,
  ]);

  await expect(completePendingHistoryMove(10)).resolves.toEqual({
    handled: true,
    oldRemoved: true,
    newHistoryId: "new-history",
  });
  expect(global.browser.downloads.removeFile).toHaveBeenCalledWith(9);
  expect(history.setStatus).toHaveBeenCalledWith("old-history", "moved", 9);
  expect(history.patch).toHaveBeenCalledWith("new-history", { rerouteOf: "old-history" });
  expect(history.patch).toHaveBeenCalledWith("old-history", { rerouteTo: "new-history" });

  downloadsState.records.clear();
  await expect(completePendingHistoryMove(10)).resolves.toEqual({
    handled: false,
    oldRemoved: false,
  });
});

test("keeps the original when its persisted identity no longer matches", async () => {
  await registerPendingHistoryMove(12, {
    historyId: "old-history",
    downloadId: 11,
    filename: "old/photo.png",
  });
  vi.mocked(global.browser.downloads.search).mockResolvedValue([
    { id: 11, filename: "/downloads/unrelated.pdf" } as never,
  ]);

  await expect(completePendingHistoryMove(12)).resolves.toMatchObject({
    handled: true,
    oldRemoved: false,
  });
  expect(global.browser.downloads.removeFile).not.toHaveBeenCalled();
  expect(history.setStatus).not.toHaveBeenCalled();
});
