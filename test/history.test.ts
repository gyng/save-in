import { SaveHistory } from "../src/background/history.ts";
import type { HistoryEntry } from "../src/shared/history-types.ts";

const HISTORY_KEY = "save-in-history";

// add() returns the entry id synchronously; the write is queued, so tests
// await SaveHistory.writeQueue to observe it
const flushWrites = () => SaveHistory.writeQueue;

describe("SaveHistory", () => {
  let store: Record<string, HistoryEntry[]>;

  beforeEach(() => {
    store = {};
    global.browser.storage.local.get = jest.fn((key: string) =>
      Promise.resolve({ [key]: store[key] }),
    );
    global.browser.storage.local.set = jest.fn((obj: Record<string, HistoryEntry[]>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    });
  });

  test("accumulates entries across saves (#history-key bug regression)", async () => {
    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    SaveHistory.add({ url: "https://a/3" });
    await flushWrites();

    expect(store[HISTORY_KEY].map((e) => e.url)).toEqual([
      "https://a/1",
      "https://a/2",
      "https://a/3",
    ]);
  });

  test("add returns an id and stamps a pending status", async () => {
    const id = SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    expect(typeof id).toBe("string");
    expect(store[HISTORY_KEY][0]).toMatchObject({ id, url: "https://a/1", status: "pending" });
  });

  test("setStatus updates only the matching entry", async () => {
    const id1 = SaveHistory.add({ url: "https://a/1" });
    const id2 = SaveHistory.add({ url: "https://a/2" });
    await flushWrites();

    SaveHistory.setStatus(id2, "complete");
    await flushWrites();

    const byId = Object.fromEntries(store[HISTORY_KEY].map((e) => [e.id, e.status]));
    expect(byId[id1]).toBe("pending");
    expect(byId[id2]).toBe("complete");
  });

  test("setStatus with no id is a no-op", async () => {
    SaveHistory.add({ url: "https://a/1" });
    await flushWrites();
    await SaveHistory.setStatus(null, "complete");
    expect(store[HISTORY_KEY][0].status).toBe("pending");
  });

  test("setStatus records the download id and file size", async () => {
    const id = SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setStatus(id, "complete", 42, 123456);
    await flushWrites();

    expect(store[HISTORY_KEY][0]).toMatchObject({
      status: "complete",
      downloadId: 42,
      fileSize: 123456,
    });
  });

  test("setDownloadId binds the id without changing status", async () => {
    const id = SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setDownloadId(id, 7);
    await flushWrites();

    expect(store[HISTORY_KEY][0]).toMatchObject({ status: "pending", downloadId: 7 });
  });

  test("get returns the entry list", async () => {
    store[HISTORY_KEY] = [{ url: "https://a/1" }];
    await expect(SaveHistory.get()).resolves.toEqual([{ url: "https://a/1" }]);
  });

  test("normalizes extended diagnostic metadata", async () => {
    store[HISTORY_KEY] = [
      {
        initiatedAt: "2024-01-01T00:00:00Z",
        menu: { id: "save-1", title: "Images", path: "images" },
        variables: { filename: "cat.png", counter: "4" },
      },
    ];
    await expect(SaveHistory.get()).resolves.toEqual(store[HISTORY_KEY]);
  });

  test("get returns an empty list when nothing saved", async () => {
    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("caps history length at SaveHistory.LIMIT", async () => {
    const limit = SaveHistory.LIMIT;
    store[HISTORY_KEY] = Array.from({ length: limit }, (_, i) => ({ url: String(i) }));

    SaveHistory.add({ url: String(limit) });
    await flushWrites();

    expect(store[HISTORY_KEY]).toHaveLength(limit);
    // The oldest entry was dropped; the newest is appended
    expect(store[HISTORY_KEY][0]).toEqual({ url: "1" });
    expect(store[HISTORY_KEY][limit - 1]).toMatchObject({ url: String(limit) });
  });

  test("add tolerates a storage backend returning nothing", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce(undefined as never);

    SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    expect(store[HISTORY_KEY][0]).toMatchObject({ url: "https://a/1" });
  });

  test("get tolerates a storage backend returning nothing", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce(undefined as never);

    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("get drops malformed persisted entries", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({
      [HISTORY_KEY]: [null, "bad", { id: 4 }, { id: "ok", downloadId: 7 }],
    } as never);
    await expect(SaveHistory.get()).resolves.toEqual([{ id: "ok", downloadId: 7 }]);
  });

  test("get reconstructs persisted entries from correctly typed allowlisted fields", async () => {
    vi.mocked(global.browser.storage.local.get).mockResolvedValueOnce({
      [HISTORY_KEY]: [
        {
          id: "h1",
          status: 7,
          timestamp: "2026-01-02T03:04:05.000Z",
          url: false,
          finalFullPath: "images/a.png",
          routed: "yes",
          observedBrowserDownload: true,
          downloadId: 42,
          fileSize: Number.POSITIVE_INFINITY,
          info: {
            sourceUrl: "https://example.test/source",
            pageUrl: 9,
            context: "MEDIA",
            secret: "discard",
          },
          state: {
            info: {
              sourceUrl: 4,
              pageUrl: "https://example.test/page",
              context: false,
              secret: "discard",
            },
            scratch: { discard: true },
          },
          unknown: "discard",
        },
      ],
    } as never);

    await expect(SaveHistory.get()).resolves.toEqual([
      {
        id: "h1",
        timestamp: "2026-01-02T03:04:05.000Z",
        finalFullPath: "images/a.png",
        observedBrowserDownload: true,
        downloadId: 42,
        info: {
          sourceUrl: "https://example.test/source",
          context: "MEDIA",
        },
        state: { info: { pageUrl: "https://example.test/page" } },
      },
    ]);
  });

  test("concurrent adds do not clobber each other (write-queue serialization)", async () => {
    global.browser.storage.local.get = jest.fn((key: string) =>
      Promise.resolve().then(() => ({ [key]: store[key] })),
    );
    global.browser.storage.local.set = jest.fn((obj: Record<string, HistoryEntry[]>) =>
      Promise.resolve().then(() => {
        Object.assign(store, obj);
      }),
    );

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    SaveHistory.add({ url: "https://a/3" });
    await flushWrites();

    expect(new Set(store[HISTORY_KEY].map((entry) => entry.url))).toEqual(
      new Set(["https://a/1", "https://a/2", "https://a/3"]),
    );
  });

  test("a failing set does not break subsequent adds", async () => {
    global.browser.storage.local.set = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation((obj: Record<string, HistoryEntry[]>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      });

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    await flushWrites();

    expect(store[HISTORY_KEY].map((e) => e.url)).toEqual(["https://a/2"]);
  });
});
