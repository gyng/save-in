import * as SaveHistory from "../../../src/background/history.ts";
import { HISTORY_LIMIT } from "../../../src/background/history.ts";
import {
  HISTORY_ENTRY_STORAGE_PREFIX,
  HISTORY_INDEX_CHUNK_STORAGE_PREFIX,
  HISTORY_INDEX_STORAGE_KEY,
} from "../../../src/shared/storage-keys.ts";
import { isStringKeyedRecord } from "../../../src/shared/util.ts";
import {
  clearPersistenceDiagnostics,
  getPersistenceDiagnostics,
} from "../../../src/shared/persistence-diagnostics.ts";

const HISTORY_KEY = "save-in-history";

// add() returns the entry id synchronously; the write is queued, so tests
// await SaveHistory.writeQueue to observe it
const flushWrites = () => SaveHistory.flushHistoryWrites();
const returnRawStorageValueOnce = (value: unknown): void => {
  const get = vi.mocked(global.browser.storage.local.get);
  Reflect.apply(get.mockResolvedValueOnce, get, [value]);
};

describe("SaveHistory", () => {
  let store: Record<string, unknown>;

  const storedHistory = () => SaveHistory.getHistoryEntries();

  beforeEach(() => {
    clearPersistenceDiagnostics();
    store = {};
    global.browser.storage.local.get = vi.fn((keys: string | string[] | null) => {
      if (keys === null) return Promise.resolve({ ...store });
      const requested = typeof keys === "string" ? [keys] : keys;
      return Promise.resolve(Object.fromEntries(requested.map((key) => [key, store[key]])));
    });
    global.browser.storage.local.set = vi.fn((obj: Record<string, unknown>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    });
    global.browser.storage.local.remove = vi.fn((keys: string | string[]) => {
      const removed = typeof keys === "string" ? [keys] : keys;
      removed.forEach((key) => delete store[key]);
      return Promise.resolve();
    });
  });

  test("accumulates entries across saves (#history-key bug regression)", async () => {
    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    SaveHistory.addHistoryEntry({ url: "https://a/2" });
    SaveHistory.addHistoryEntry({ url: "https://a/3" });
    await flushWrites();

    expect((await storedHistory()).map((entry) => entry.url)).toEqual([
      "https://a/1",
      "https://a/2",
      "https://a/3",
    ]);
  });

  test("add returns an id and stamps a pending status", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    expect(typeof id).toBe("string");
    expect((await storedHistory())[0]).toMatchObject({
      id,
      url: "https://a/1",
      status: "pending",
    });
  });

  test("reads one sharded entry without loading unrelated entry records", async () => {
    const first = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    const second = SaveHistory.addHistoryEntry({ url: "https://a/2" });
    await flushWrites();
    vi.mocked(global.browser.storage.local.get).mockClear();

    await expect(SaveHistory.getHistoryEntries(second ?? undefined)).resolves.toEqual([
      expect.objectContaining({ id: second, url: "https://a/2" }),
    ]);

    expect(global.browser.storage.local.get).toHaveBeenNthCalledWith(1, [
      HISTORY_INDEX_STORAGE_KEY,
      HISTORY_KEY,
    ]);
    expect(global.browser.storage.local.get).toHaveBeenNthCalledWith(2, [
      `${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`,
    ]);
    expect(global.browser.storage.local.get).toHaveBeenNthCalledWith(3, [
      `${HISTORY_ENTRY_STORAGE_PREFIX}${second}`,
    ]);
    expect(global.browser.storage.local.get).not.toHaveBeenCalledWith([
      `${HISTORY_ENTRY_STORAGE_PREFIX}${first}`,
    ]);
  });

  test("returns no sharded entry when the requested id is absent", async () => {
    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    vi.mocked(global.browser.storage.local.get).mockClear();

    await expect(SaveHistory.getHistoryEntries("missing")).resolves.toEqual([]);

    expect(global.browser.storage.local.get).toHaveBeenCalledTimes(2);
  });

  test("does not persist entries from private browsing contexts", async () => {
    const id = SaveHistory.addHistoryEntry(
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
    const id1 = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    const id2 = SaveHistory.addHistoryEntry({ url: "https://a/2" });
    await flushWrites();

    SaveHistory.setHistoryStatus(id2, "complete");
    await flushWrites();

    const byId = Object.fromEntries(
      (await storedHistory()).map((entry) => [entry.id, entry.status]),
    );
    expect(byId[id1!]).toBe("pending");
    expect(byId[id2!]).toBe("complete");
  });

  test("setStatus with no id is a no-op", async () => {
    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    await SaveHistory.setHistoryStatus(null, "complete");
    expect((await storedHistory())[0]?.status).toBe("pending");
  });

  test("setStatus records the download id and file size", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setHistoryStatus(id, "complete", 42, 123456);
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      status: "complete",
      downloadId: 42,
      fileSize: 123456,
    });
  });

  test("setDownloadId binds the id without changing status", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setHistoryDownloadId(id, 7);
    await flushWrites();

    const [entry] = await storedHistory();
    expect(entry).toMatchObject({ status: "pending", downloadId: 7 });
    // Without a startTime the undo-identity field must not be written at all.
    expect(entry).not.toHaveProperty("downloadStartTime");
  });

  test("setDownloadId persists the start time for the undo identity check", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      downloadId: 7,
      downloadStartTime: "2026-07-17T01:02:03.000Z",
    });
  });

  test("patch merges a plain field object into the matching entry", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    SaveHistory.patchHistoryEntry(id, { fileSize: 4096 });
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({ url: "https://a/1", fileSize: 4096 });
  });

  test("setDownloadId keeps a captured start time on a same-id bind without one", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    // The launch path binds the bare id; onDownloadCreated supplied the time.
    // Whichever order they land in, the time survives.
    SaveHistory.setHistoryDownloadId(id, 7);
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      downloadId: 7,
      downloadStartTime: "2026-07-17T01:02:03.000Z",
    });
  });

  test("setDownloadId rebinding a different id without a time clears the stale one", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    SaveHistory.setHistoryDownloadId(id, 8);
    await flushWrites();

    // A stale time would refuse undo of the download the entry now points at.
    const [entry] = await storedHistory();
    expect(entry).toMatchObject({ downloadId: 8 });
    expect(entry).not.toHaveProperty("downloadStartTime");
  });

  test("setStatus rebinding a different id clears the stale start time", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    // The fetch-retry replacement completes under its new download id.
    SaveHistory.setHistoryStatus(id, "complete", 8);
    await flushWrites();

    const [entry] = await storedHistory();
    expect(entry).toMatchObject({ status: "complete", downloadId: 8 });
    expect(entry).not.toHaveProperty("downloadStartTime");
  });

  test("setStatus with the same id keeps the captured start time", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    SaveHistory.setHistoryStatus(id, "complete", 7);
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      status: "complete",
      downloadId: 7,
      downloadStartTime: "2026-07-17T01:02:03.000Z",
    });
  });

  test("anchorStartTime applies only to an unanchored entry still on its download", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7);
    await flushWrites();

    SaveHistory.anchorHistoryDownloadStartTime(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      downloadId: 7,
      downloadStartTime: "2026-07-17T01:02:03.000Z",
    });
  });

  test("anchorStartTime never repoints an entry a retry has rebound", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    // The fetch retry rebound the entry to the replacement download before
    // the launch path's late backfill for the dead original landed.
    SaveHistory.setHistoryDownloadId(id, 8, "2026-07-18T09:08:07.000Z");
    await flushWrites();

    SaveHistory.anchorHistoryDownloadStartTime(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({
      downloadId: 8,
      downloadStartTime: "2026-07-18T09:08:07.000Z",
    });
  });

  test("anchorStartTime does not overwrite an anchor the event path captured", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    SaveHistory.setHistoryDownloadId(id, 7, "2026-07-17T01:02:03.000Z");
    await flushWrites();
    const writes = vi.mocked(global.browser.storage.local.set).mock.calls.length;

    SaveHistory.anchorHistoryDownloadStartTime(id, 7, "2026-07-17T09:09:09.000Z");
    await flushWrites();

    // The guarded no-op must also skip the storage write entirely: bulk
    // automatic saves would otherwise double history churn for nothing.
    expect((await storedHistory())[0]).toMatchObject({
      downloadStartTime: "2026-07-17T01:02:03.000Z",
    });
    expect(vi.mocked(global.browser.storage.local.set).mock.calls.length).toBe(writes);
  });

  test("get returns the entry list", async () => {
    store[HISTORY_KEY] = [{ url: "https://a/1" }];
    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([{ url: "https://a/1" }]);
  });

  test("finds one legacy entry while migrating the monolithic store", async () => {
    store[HISTORY_KEY] = [
      { id: "first", url: "https://a/1" },
      { id: "second", url: "https://a/2" },
    ];

    await expect(SaveHistory.getHistoryEntries("second")).resolves.toEqual([
      { id: "second", url: "https://a/2" },
    ]);
    expect(store[HISTORY_INDEX_STORAGE_KEY]).toMatchObject({ length: 2 });
  });

  test("normalizes extended diagnostic metadata", async () => {
    const legacy = [
      {
        initiatedAt: "2024-01-01T00:00:00Z",
        menu: { id: "save-1", title: "Images", path: "images" },
        variables: { filename: "cat.png", counter: "4" },
      },
    ];
    store[HISTORY_KEY] = legacy;
    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual(legacy);
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

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([
      {
        timestamp: expectedTimestamp,
        initiatedAt: expectedInitiatedAt,
        finalFullPath: "old.png",
        mechanism: "downloads-api",
      },
    ]);
    const migratedRawEntry = Object.values(store).find(
      (value) => isStringKeyedRecord(value) && "futureMetadata" in value,
    );
    expect(migratedRawEntry).toMatchObject({
      timestamp: expectedTimestamp,
      initiatedAt: expectedInitiatedAt,
      mechanism: "downloads-api",
      futureMetadata: { preserve: true },
    });
    const writes = vi.mocked(global.browser.storage.local.set).mock.calls.length;
    await SaveHistory.getHistoryEntries();
    expect(global.browser.storage.local.set).toHaveBeenCalledTimes(writes);
  });

  test("get returns an empty list when nothing saved", async () => {
    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([]);
  });

  test("falls back from a malformed sharded index to legacy history", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 0,
      length: 1,
    };
    store[HISTORY_KEY] = [{ url: "https://a/legacy" }];

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([{ url: "https://a/legacy" }]);
  });

  test("ignores malformed sharded chunks, locators, and entries", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 2,
      length: 2,
    };
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`] = "not-an-array";
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}1`] = ["bad-entry"];
    store[`${HISTORY_ENTRY_STORAGE_PREFIX}bad-entry`] = null;

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([]);
  });

  test("keeps duplicate legacy ids under distinct shard keys", async () => {
    store[HISTORY_KEY] = [
      { id: "same", url: "https://a/1" },
      { id: "same", url: "https://a/2" },
    ];

    await expect(SaveHistory.getHistoryEntries()).resolves.toHaveLength(2);
    expect(store[`${HISTORY_ENTRY_STORAGE_PREFIX}same`]).toBeDefined();
    expect(store[`${HISTORY_ENTRY_STORAGE_PREFIX}same-legacy-1`]).toBeDefined();
  });

  test("clear is serialized after already queued writes", async () => {
    SaveHistory.addHistoryEntry({ url: "https://a/queued" });

    await SaveHistory.clearHistory();

    expect(store[HISTORY_KEY]).toBeUndefined();
    expect(global.browser.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining([
        HISTORY_INDEX_STORAGE_KEY,
        expect.stringMatching(`^${HISTORY_ENTRY_STORAGE_PREFIX}`),
      ]),
    );
  });

  test("caps history length at HISTORY_LIMIT", async () => {
    const limit = HISTORY_LIMIT;
    store[HISTORY_KEY] = Array.from({ length: limit }, (_, i) => ({ url: String(i) }));

    SaveHistory.addHistoryEntry({ url: String(limit) });
    await flushWrites();

    const history = await storedHistory();
    expect(history).toHaveLength(limit);
    // The oldest entry was dropped; the newest is appended
    expect(history[0]).toEqual({ url: "1" });
    expect(history[limit - 1]).toMatchObject({ url: String(limit) });
  });

  test("starts a new index chunk after the current chunk fills", async () => {
    for (let index = 0; index < 129; index += 1) {
      SaveHistory.addHistoryEntry({ url: `https://a/${index}` });
    }
    await flushWrites();

    expect(store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`]).toHaveLength(128);
    expect(store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}1`]).toHaveLength(1);
  });

  test("removes a consumed one-entry first chunk at the history limit", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 2,
      length: HISTORY_LIMIT,
    };
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`] = ["oldest"];
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}1`] = [];
    store[`${HISTORY_ENTRY_STORAGE_PREFIX}oldest`] = { id: "oldest", url: "https://a/old" };

    SaveHistory.addHistoryEntry({ url: "https://a/new" });
    await flushWrites();

    expect(store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`]).toBeUndefined();
    expect(store[`${HISTORY_ENTRY_STORAGE_PREFIX}oldest`]).toBeUndefined();
    expect(store[HISTORY_INDEX_STORAGE_KEY]).toMatchObject({ firstChunk: 1 });
  });

  test("contains a capped append when the first chunk is malformed", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 2,
      length: HISTORY_LIMIT,
    };
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`] = "not-an-array";
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}1`] = [];

    SaveHistory.addHistoryEntry({ url: "https://a/new" });
    await expect(flushWrites()).resolves.toBeUndefined();
    expect(store[HISTORY_INDEX_STORAGE_KEY]).toMatchObject({ firstChunk: 1 });
  });

  test("add tolerates a storage backend returning nothing", async () => {
    returnRawStorageValueOnce(undefined);

    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();

    expect((await storedHistory())[0]).toMatchObject({ url: "https://a/1" });
  });

  test("get tolerates a storage backend returning nothing", async () => {
    returnRawStorageValueOnce(undefined);

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([]);
  });

  test("get rejects an array-shaped storage snapshot", async () => {
    returnRawStorageValueOnce(Object.assign([], { [HISTORY_KEY]: [{ id: "array-property" }] }));

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([]);
  });

  test("get drops malformed persisted entries", async () => {
    returnRawStorageValueOnce({
      [HISTORY_KEY]: [null, "bad", { id: 4 }, { id: "ok", downloadId: 7 }],
    });
    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([{ id: "ok", downloadId: 7 }]);
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

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([
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
    global.browser.storage.local.set = vi.fn((obj: Record<string, unknown>) =>
      Promise.resolve().then(() => {
        Object.assign(store, obj);
      }),
    );

    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    SaveHistory.addHistoryEntry({ url: "https://a/2" });
    SaveHistory.addHistoryEntry({ url: "https://a/3" });
    await flushWrites();

    expect(new Set((await storedHistory()).map((entry) => entry.url))).toEqual(
      new Set(["https://a/1", "https://a/2", "https://a/3"]),
    );
  });

  test("an add accepted during legacy migration is serialized after it", async () => {
    store[HISTORY_KEY] = [{ url: "https://a/legacy" }];
    const baseGet = global.browser.storage.local.get;
    let releaseRead: (() => void) | undefined;
    const readBlocked = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let firstRead = true;
    global.browser.storage.local.get = vi.fn(async (...args) => {
      if (firstRead) {
        firstRead = false;
        await readBlocked;
      }
      return Reflect.apply(baseGet, global.browser.storage.local, args);
    });

    const legacyRead = SaveHistory.getHistoryEntries();
    await vi.waitFor(() => expect(global.browser.storage.local.get).toHaveBeenCalled());
    SaveHistory.addHistoryEntry({ url: "https://a/new" });
    releaseRead?.();

    await expect(legacyRead).resolves.toEqual([{ url: "https://a/legacy" }]);
    await flushWrites();
    expect((await storedHistory()).map((entry) => entry.url)).toEqual([
      "https://a/legacy",
      "https://a/new",
    ]);
  });

  test("patching one entry does not rewrite the complete history", async () => {
    for (let index = 0; index < 100; index += 1) {
      SaveHistory.addHistoryEntry({
        url: `https://example.test/${index}/${"payload".repeat(20)}`,
      });
    }
    await flushWrites();
    const id = (await storedHistory()).at(-1)?.id;
    expect(id).toBeTypeOf("string");
    vi.mocked(global.browser.storage.local.set).mockClear();

    await SaveHistory.patchHistoryEntry(id, { status: "complete" });

    expect(global.browser.storage.local.set).toHaveBeenCalledOnce();
    const payload = vi.mocked(global.browser.storage.local.set).mock.calls[0]?.[0];
    expect(JSON.stringify(payload).length).toBeLessThan(2_000);
  });

  test("reloads a patch target omitted from the index snapshot", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/1" });
    await flushWrites();
    if (!id) throw new Error("history id was not created");
    const entryKey = `${HISTORY_ENTRY_STORAGE_PREFIX}${id}`;
    const baseGet = global.browser.storage.local.get;
    let omitted = false;
    global.browser.storage.local.get = vi.fn((keys: string | string[] | null) => {
      if (!omitted && Array.isArray(keys) && keys.includes(entryKey)) {
        omitted = true;
        const snapshot = Reflect.apply(baseGet, global.browser.storage.local, [keys]);
        return Promise.resolve(snapshot).then((resolved) => {
          const withoutEntry = { ...resolved };
          delete withoutEntry[entryKey];
          return withoutEntry;
        });
      }
      return Reflect.apply(baseGet, global.browser.storage.local, [keys]);
    });

    await SaveHistory.patchHistoryEntry(id, { status: "complete" });

    expect(store[entryKey]).toMatchObject({ status: "complete" });
  });

  test("ignores a patch whose stored target is malformed", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 1,
      length: 1,
    };
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`] = ["bad-entry"];
    store[`${HISTORY_ENTRY_STORAGE_PREFIX}bad-entry`] = null;
    vi.mocked(global.browser.storage.local.set).mockClear();

    await SaveHistory.patchHistoryEntry("bad-entry", { status: "complete" });

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("a failing set does not break subsequent adds", async () => {
    global.browser.storage.local.set = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation((obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      });

    SaveHistory.addHistoryEntry({ url: "https://a/1" });
    SaveHistory.addHistoryEntry({ url: "https://a/2" });
    await flushWrites();

    expect((await storedHistory()).map((entry) => entry.url)).toEqual(["https://a/2"]);
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

    await expect(SaveHistory.getHistoryEntries()).rejects.toThrow("read denied");
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "read", key: HISTORY_KEY }),
    ]);
  });

  test("reports and rethrows a sharded history read failure", async () => {
    global.browser.storage.local.get = vi
      .fn()
      .mockResolvedValueOnce({
        [HISTORY_INDEX_STORAGE_KEY]: {
          version: 1,
          firstChunk: 0,
          nextChunk: 1,
          length: 1,
        },
      })
      .mockRejectedValueOnce(new Error("chunk read denied"));

    await expect(SaveHistory.getHistoryEntries()).rejects.toThrow("chunk read denied");
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "read", key: HISTORY_KEY }),
    ]);
  });

  test("prefers a completed sharded index over a leftover legacy value", async () => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 0,
      length: 0,
    };
    store[HISTORY_KEY] = [{ timestamp: "2024-01-02", url: "https://old" }];

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([]);

    expect(global.browser.storage.local.set).not.toHaveBeenCalled();
  });

  test("contains a failed legacy migration write", async () => {
    store[HISTORY_KEY] = [{ timestamp: "2024-01-02", url: "https://old" }];
    global.browser.storage.local.set = vi.fn(() => Promise.reject(new Error("migration denied")));

    await expect(SaveHistory.getHistoryEntries()).resolves.toEqual([
      expect.objectContaining({ timestamp: expect.stringContaining("T") }),
    ]);
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "migrate", key: HISTORY_KEY }),
    ]);
  });

  test("clear rejects its caller but leaves the queue usable after remove fails", async () => {
    store[HISTORY_KEY] = [];
    global.browser.storage.local.remove = vi
      .fn()
      .mockRejectedValueOnce(new Error("remove denied"))
      .mockResolvedValueOnce(undefined);

    await expect(SaveHistory.clearHistory()).rejects.toThrow("remove denied");
    await expect(SaveHistory.clearHistory()).resolves.toBeUndefined();
    await flushWrites();
    expect(getPersistenceDiagnostics()).toEqual([
      expect.objectContaining({ operation: "remove", key: HISTORY_KEY }),
    ]);
  });

  test("clear recovers from an already rejected write queue", async () => {
    store[HISTORY_KEY] = [];
    SaveHistory.seedHistoryWriteQueueForTest(Promise.reject(new Error("earlier write failed")));

    await expect(SaveHistory.clearHistory()).resolves.toBeUndefined();

    expect(global.browser.storage.local.remove).toHaveBeenCalledWith(
      expect.arrayContaining([HISTORY_KEY]),
    );
  });

  test("clear skips storage removal when history is already absent", async () => {
    await expect(SaveHistory.clearHistory()).resolves.toBeUndefined();

    expect(global.browser.storage.local.remove).not.toHaveBeenCalled();
  });
});
