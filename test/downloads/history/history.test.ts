import { SaveHistory } from "../../../src/background/history.ts";
import type { HistoryEntry } from "../../../src/shared/history-types.ts";
import {
  clearPersistenceDiagnostics,
  getPersistenceDiagnostics,
} from "../../../src/shared/persistence-diagnostics.ts";

const HISTORY_KEY = "save-in-history";
type PersistedHistoryEntry = HistoryEntry & Record<string, unknown>;

// add() returns the entry id synchronously; the write is queued, so tests
// await SaveHistory.writeQueue to observe it
const flushWrites = () => SaveHistory.writeQueue;
const returnRawStorageValueOnce = (value: unknown): void => {
  const get = vi.mocked(global.browser.storage.local.get);
  Reflect.apply(get.mockResolvedValueOnce, get, [value]);
};

describe("SaveHistory", () => {
  let store: Record<string, PersistedHistoryEntry[]>;

  beforeEach(() => {
    clearPersistenceDiagnostics();
    store = {};
    global.browser.storage.local.get = vi.fn((key: string) =>
      Promise.resolve({ [key]: store[key] }),
    );
    global.browser.storage.local.set = vi.fn((obj: Record<string, PersistedHistoryEntry[]>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    });
    global.browser.storage.local.remove = vi.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    });
  });

  test("accumulates entries across saves (#history-key bug regression)", async () => {
    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    SaveHistory.add({ url: "https://a/3" });
    await flushWrites();

    expect(store[HISTORY_KEY]!.map((e) => e.url)).toEqual([
      "https://a/1",
      "https://a/2",
      "https://a/3",
    ]);
  });

  test("add returns an id and stamps a pending status", async () => {
    const id = SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    expect(typeof id).toBe("string");
    expect(store[HISTORY_KEY]![0]!).toMatchObject({ id, url: "https://a/1", status: "pending" });
  });

  test("does not persist entries from private browsing contexts", async () => {
    const id = SaveHistory.add(
      { url: "https://private.example/secret.png" },
      { privateContext: true },
    );
    await flushWrites();

    expect(id).toBeNull();
    expect(global.browser.storage.local.get).not.toHaveBeenCalled();
    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
    expect(store[HISTORY_KEY]).toBeUndefined();
  });

  test("setStatus updates only the matching entry", async () => {
    const id1 = SaveHistory.add({ url: "https://a/1" });
    const id2 = SaveHistory.add({ url: "https://a/2" });
    await flushWrites();

    SaveHistory.setStatus(id2, "complete");
    await flushWrites();

    const byId = Object.fromEntries(store[HISTORY_KEY]!.map((e) => [e.id, e.status]));
    expect(byId[id1!]).toBe("pending");
    expect(byId[id2!]).toBe("complete");
  });

  test("setStatus with no id is a no-op", async () => {
    SaveHistory.add({ url: "https://a/1" });
    await flushWrites();
    await SaveHistory.setStatus(null, "complete");
    expect(store[HISTORY_KEY]![0]!.status).toBe("pending");
  });

  test("setStatus records the download id and file size", async () => {
    const id = SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setStatus(id, "complete", 42, 123456);
    await flushWrites();

    expect(store[HISTORY_KEY]![0]!).toMatchObject({
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

    expect(store[HISTORY_KEY]![0]!).toMatchObject({ status: "pending", downloadId: 7 });
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

  test("migrates legacy local calendar dates to UTC once", async () => {
    store[HISTORY_KEY] = [
      {
        timestamp: "2024-01-02",
        initiatedAt: "2024-01-03",
        finalFullPath: "old.png",
        mechanism: "downloads-api",
        futureMetadata: { preserve: true },
      },
    ];
    const expectedTimestamp = new Date(2024, 0, 2).toISOString();
    const expectedInitiatedAt = new Date(2024, 0, 3).toISOString();

    await expect(SaveHistory.get()).resolves.toEqual([
      {
        timestamp: expectedTimestamp,
        initiatedAt: expectedInitiatedAt,
        finalFullPath: "old.png",
        mechanism: "downloads-api",
      },
    ]);
    expect(store[HISTORY_KEY][0]!).toMatchObject({
      timestamp: expectedTimestamp,
      initiatedAt: expectedInitiatedAt,
      mechanism: "downloads-api",
      futureMetadata: { preserve: true },
    });
    const writes = vi.mocked(global.browser.storage.local.set).mock.calls.length;
    await SaveHistory.get();
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(writes);
  });

  test("get returns an empty list when nothing saved", async () => {
    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("clear is serialized after already queued writes", async () => {
    SaveHistory.add({ url: "https://a/queued" });

    await SaveHistory.clear();

    expect(store[HISTORY_KEY]).toBeUndefined();
    expect(global.browser.storage.local.remove).toHaveBeenCalledWith(HISTORY_KEY);
  });

  test("caps history length at SaveHistory.LIMIT", async () => {
    const limit = SaveHistory.LIMIT;
    store[HISTORY_KEY] = Array.from({ length: limit }, (_, i) => ({ url: String(i) }));

    SaveHistory.add({ url: String(limit) });
    await flushWrites();

    expect(store[HISTORY_KEY]).toHaveLength(limit);
    // The oldest entry was dropped; the newest is appended
    expect(store[HISTORY_KEY][0]!).toEqual({ url: "1" });
    expect(store[HISTORY_KEY][limit - 1]).toMatchObject({ url: String(limit) });
  });

  test("add tolerates a storage backend returning nothing", async () => {
    returnRawStorageValueOnce(undefined);

    SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    expect(store[HISTORY_KEY]![0]!).toMatchObject({ url: "https://a/1" });
  });

  test("get tolerates a storage backend returning nothing", async () => {
    returnRawStorageValueOnce(undefined);

    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("get rejects an array-shaped storage snapshot", async () => {
    returnRawStorageValueOnce(Object.assign([], { [HISTORY_KEY]: [{ id: "array-property" }] }));

    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("get drops malformed persisted entries", async () => {
    returnRawStorageValueOnce({
      [HISTORY_KEY]: [null, "bad", { id: 4 }, { id: "ok", downloadId: 7 }],
    });
    await expect(SaveHistory.get()).resolves.toEqual([{ id: "ok", downloadId: 7 }]);
  });

  test("get reconstructs persisted entries from correctly typed allowlisted fields", async () => {
    returnRawStorageValueOnce({
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
    });

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
    global.browser.storage.local.get = vi.fn((key: string) =>
      Promise.resolve().then(() => ({ [key]: store[key] })),
    );
    global.browser.storage.local.set = vi.fn((obj: Record<string, PersistedHistoryEntry[]>) =>
      Promise.resolve().then(() => {
        Object.assign(store, obj);
      }),
    );

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    SaveHistory.add({ url: "https://a/3" });
    await flushWrites();

    expect(new Set(store[HISTORY_KEY]!.map((entry) => entry.url))).toEqual(
      new Set(["https://a/1", "https://a/2", "https://a/3"]),
    );
  });

  test("a failing set does not break subsequent adds", async () => {
    global.browser.storage.local.set = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation((obj: Record<string, PersistedHistoryEntry[]>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      });

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    await flushWrites();

    expect(store[HISTORY_KEY]!.map((e) => e.url)).toEqual(["https://a/2"]);
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({
        area: "local",
        operation: "write",
        key: HISTORY_KEY,
        error: "Error: boom",
      }),
    ]);
  });

  test("reports and rethrows a history read failure", async () => {
    global.browser.storage.local.get = vi.fn(() => Promise.reject(new Error("read denied")));

    await expect(SaveHistory.get()).rejects.toThrow("read denied");
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "read", key: HISTORY_KEY }),
    ]);
  });

  test("skips migration when a newer write already normalized the latest value", async () => {
    const legacy = [{ timestamp: "2024-01-02", url: "https://old" }];
    const normalized = [{ timestamp: "2024-01-02T00:00:00.000Z", url: "https://new" }];
    global.browser.storage.local.get = vi
      .fn()
      .mockResolvedValueOnce({ [HISTORY_KEY]: legacy })
      .mockResolvedValueOnce({ [HISTORY_KEY]: normalized });

    await SaveHistory.get();

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("contains a failed legacy migration write", async () => {
    store[HISTORY_KEY] = [{ timestamp: "2024-01-02", url: "https://old" }];
    global.browser.storage.local.set = vi.fn(() => Promise.reject(new Error("migration denied")));

    await expect(SaveHistory.get()).resolves.toEqual([
      expect.objectContaining({ timestamp: expect.stringContaining("T") }),
    ]);
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "migrate", key: HISTORY_KEY }),
    ]);
  });

  test("clear rejects its caller but leaves the queue usable after remove fails", async () => {
    global.browser.storage.local.remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("remove denied"))
      .mockResolvedValueOnce(undefined);

    await expect(SaveHistory.clear()).rejects.toThrow("remove denied");
    await expect(SaveHistory.clear()).resolves.toBeUndefined();
    await flushWrites();
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "remove", key: HISTORY_KEY }),
    ]);
  });

  test("clear recovers from an already rejected write queue", async () => {
    SaveHistory.writeQueue = Promise.reject(new Error("earlier write failed"));

    await expect(SaveHistory.clear()).resolves.toBeUndefined();

    expect(global.browser.storage.local.remove).toHaveBeenCalledWith(HISTORY_KEY);
  });
});
