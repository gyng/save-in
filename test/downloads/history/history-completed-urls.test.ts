// The in-memory index behind "skip addresses already saved": built lazily by
// one read, kept exact by each History write, and rebuilt after anything that
// loses track of it (including a restarted background, modelled here by a
// fresh module instance per test).
import {
  HISTORY_ENTRY_STORAGE_PREFIX,
  HISTORY_INDEX_CHUNK_STORAGE_PREFIX,
  HISTORY_INDEX_STORAGE_KEY,
} from "../../../src/shared/storage-keys.ts";

const HISTORY_KEY = "save-in-history";

type HistoryModule = typeof import("../../../src/background/history.ts");
type OptionsModule = typeof import("../../../src/config/options-data.ts");

describe("completed-address index", () => {
  let store: Record<string, unknown>;
  let SaveHistory: HistoryModule;
  let options: OptionsModule["options"];

  const loadFreshBackground = async () => {
    vi.resetModules();
    SaveHistory = await import("../../../src/background/history.ts");
    ({ options } = await import("../../../src/config/options-data.ts"));
    options.persistPrivateActivity = false;
    options.historyRetentionLimit = SaveHistory.HISTORY_LIMIT;
  };

  const storageReads = () => vi.mocked(global.browser.storage.local.get);
  const complete = async (url: string) => {
    const id = SaveHistory.addHistoryEntry({ url });
    await SaveHistory.setHistoryStatus(id, "complete");
    return id;
  };

  beforeEach(async () => {
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
    await loadFreshBackground();
  });

  test("counts only completed entries with a stable address", async () => {
    await complete("https://a/done");
    SaveHistory.addHistoryEntry({ url: "https://a/in-flight" });
    for (const status of ["USER_CANCELED", "CONFLICT_SKIPPED", "NETWORK_FAILED", "RULE_NO_MATCH"]) {
      await SaveHistory.setHistoryStatus(
        SaveHistory.addHistoryEntry({ url: `https://a/${status}` }),
        status,
      );
    }
    await complete("data:image/png;base64,AAAA");
    await complete("blob:https://a/7f1c");
    const oversized = `https://a/${"x".repeat(4096)}`;
    await complete(oversized);
    await SaveHistory.setHistoryStatus(SaveHistory.addHistoryEntry({}), "complete");

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);
    for (const url of [
      "https://a/in-flight",
      "https://a/USER_CANCELED",
      "https://a/CONFLICT_SKIPPED",
      "https://a/NETWORK_FAILED",
      "https://a/RULE_NO_MATCH",
      "data:image/png;base64,AAAA",
      "blob:https://a/7f1c",
      oversized,
      "https://a/never-saved",
    ]) {
      await expect(SaveHistory.hasCompletedHistoryUrl(url)).resolves.toBe(false);
    }
  });

  test("answers repeated lookups from memory after one History read", async () => {
    await complete("https://a/done");
    storageReads().mockClear();

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);
    const readsToBuild = storageReads().mock.calls.length;
    expect(readsToBuild).toBeGreaterThan(0);

    for (let candidate = 0; candidate < 100; candidate += 1) {
      await SaveHistory.hasCompletedHistoryUrl(`https://a/candidate-${candidate}`);
    }
    expect(storageReads()).toHaveBeenCalledTimes(readsToBuild);
  });

  test("concurrent first lookups share one build", async () => {
    await complete("https://a/done");
    storageReads().mockClear();
    await SaveHistory.hasCompletedHistoryUrl("https://a/done");
    const readsToBuild = storageReads().mock.calls.length;
    await loadFreshBackground();
    storageReads().mockClear();

    await expect(
      Promise.all([
        SaveHistory.hasCompletedHistoryUrl("https://a/done"),
        SaveHistory.hasCompletedHistoryUrl("https://a/other"),
        SaveHistory.hasCompletedHistoryUrl("https://a/done"),
      ]),
    ).resolves.toEqual([true, false, true]);
    expect(storageReads()).toHaveBeenCalledTimes(readsToBuild);
  });

  test("a restarted background rebuilds the index from storage", async () => {
    await complete("https://a/done");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);

    await loadFreshBackground();
    storageReads().mockClear();

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);
    expect(storageReads()).toHaveBeenCalled();
  });

  test("treats a legacy row without a status as completed while migrating it", async () => {
    store[HISTORY_KEY] = [{ url: "https://a/legacy" }, { url: "https://a/x", status: "pending" }];

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/legacy")).resolves.toBe(true);
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/x")).resolves.toBe(false);
    expect(store[HISTORY_INDEX_STORAGE_KEY]).toMatchObject({ length: 2 });
  });

  test("follows a save from in-flight to completed without rereading History", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/new" });
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/new")).resolves.toBe(false);
    // Rebuilding would have to read the locator chunks again.
    storageReads().mockClear();
    const chunkReads = () =>
      storageReads().mock.calls.filter(
        ([keys]) =>
          Array.isArray(keys) &&
          keys.some((key) => key.startsWith(HISTORY_INDEX_CHUNK_STORAGE_PREFIX)),
      );

    await SaveHistory.setHistoryDownloadId(id, 7);
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/new")).resolves.toBe(false);
    await SaveHistory.setHistoryStatus(id, "complete", 7, 1024);
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/new")).resolves.toBe(true);
    // A later patch of the completed row neither drops nor double-counts it.
    await SaveHistory.patchHistoryEntry(id, { finalFullPath: "moved/new" });
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/new")).resolves.toBe(true);
    await SaveHistory.setHistoryStatus(id, "FILE_REMOVED");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/new")).resolves.toBe(false);

    expect(chunkReads()).toEqual([]);
  });

  test("keeps an address while any completed row still records it", async () => {
    const first = await complete("https://a/twice");
    const second = await complete("https://a/twice");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/twice")).resolves.toBe(true);

    await SaveHistory.setHistoryStatus(first, "FILE_REMOVED");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/twice")).resolves.toBe(true);
    await SaveHistory.setHistoryStatus(second, "FILE_REMOVED");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/twice")).resolves.toBe(false);
  });

  test("forgets an address when retention prunes its entry", async () => {
    options.historyRetentionLimit = 1;
    await complete("https://a/older");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/older")).resolves.toBe(true);

    await complete("https://a/newer");

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/older")).resolves.toBe(false);
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/newer")).resolves.toBe(true);
  });

  test("matches nothing while the retention limit is zero", async () => {
    options.historyRetentionLimit = 0;
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/gone")).resolves.toBe(false);

    await complete("https://a/gone");

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/gone")).resolves.toBe(false);
  });

  test.each([
    ["with terminal-count metadata", { terminalCount: 1 }],
    ["on an index written before that metadata", {}],
  ])("forgets the address the row cap evicts %s", async (_label, metadata) => {
    store[HISTORY_INDEX_STORAGE_KEY] = {
      version: 1,
      firstChunk: 0,
      nextChunk: 2,
      length: SaveHistory.HISTORY_LIMIT,
      ...metadata,
    };
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}0`] = ["oldest"];
    store[`${HISTORY_INDEX_CHUNK_STORAGE_PREFIX}1`] = [];
    store[`${HISTORY_ENTRY_STORAGE_PREFIX}oldest`] = {
      id: "oldest",
      status: "complete",
      url: "https://a/old",
    };
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/old")).resolves.toBe(true);

    SaveHistory.addHistoryEntry({ url: "https://a/new" });
    await SaveHistory.flushHistoryWrites();

    expect(store[`${HISTORY_ENTRY_STORAGE_PREFIX}oldest`]).toBeUndefined();
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/old")).resolves.toBe(false);
  });

  test("matches nothing after History is cleared, then tracks new saves", async () => {
    await complete("https://a/done");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);

    await SaveHistory.clearHistory();

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(false);
    await complete("https://a/after");
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/after")).resolves.toBe(true);
  });

  test("rereads History after a write it could not track", async () => {
    const id = SaveHistory.addHistoryEntry({ url: "https://a/lost" });
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/lost")).resolves.toBe(false);
    // Another context completes the row while this one's own write fails.
    vi.mocked(global.browser.storage.local.set).mockImplementationOnce(() => {
      store[`${HISTORY_ENTRY_STORAGE_PREFIX}${id}`] = {
        id,
        status: "complete",
        url: "https://a/lost",
      };
      return Promise.reject(new Error("quota"));
    });

    await SaveHistory.patchHistoryEntry(id, { finalFullPath: "x" });

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/lost")).resolves.toBe(true);
  });

  test("rejects when History cannot be read and recovers on the next lookup", async () => {
    await complete("https://a/done");
    await loadFreshBackground();
    storageReads().mockRejectedValueOnce(new Error("read denied"));

    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).rejects.toThrow(
      "read denied",
    );
    await expect(SaveHistory.hasCompletedHistoryUrl("https://a/done")).resolves.toBe(true);
  });
});
