const SaveHistory = (await import("../src/history.js")).default;

const HISTORY_KEY = "save-in-history";

// add() returns the entry id synchronously; the write is queued, so tests
// await SaveHistory.writeQueue to observe it
const flushWrites = () => SaveHistory.writeQueue;

describe("SaveHistory", () => {
  let store;

  beforeEach(() => {
    store = {};
    global.browser.storage.local.get = jest.fn((key) => Promise.resolve({ [key]: store[key] }));
    global.browser.storage.local.set = jest.fn((obj) => {
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

  test("get returns the entry list", async () => {
    store[HISTORY_KEY] = [{ url: "https://a/1" }];
    await expect(SaveHistory.get()).resolves.toEqual([{ url: "https://a/1" }]);
  });

  test("get returns an empty list when nothing saved", async () => {
    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("caps history length", async () => {
    store[HISTORY_KEY] = Array.from({ length: 100 }, (_, i) => ({ i }));

    SaveHistory.add({ i: 100 });
    await flushWrites();

    expect(store[HISTORY_KEY]).toHaveLength(100);
    expect(store[HISTORY_KEY][0]).toEqual({ i: 1 });
    expect(store[HISTORY_KEY][99]).toMatchObject({ i: 100 });
  });

  test("add tolerates a storage backend returning nothing", async () => {
    global.browser.storage.local.get.mockResolvedValueOnce(undefined);

    SaveHistory.add({ url: "https://a/1" });
    await flushWrites();

    expect(store[HISTORY_KEY][0]).toMatchObject({ url: "https://a/1" });
  });

  test("get tolerates a storage backend returning nothing", async () => {
    global.browser.storage.local.get.mockResolvedValueOnce(undefined);

    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("concurrent adds do not clobber each other (write-queue serialization)", async () => {
    global.browser.storage.local.get = jest.fn((key) =>
      Promise.resolve().then(() => ({ [key]: store[key] })),
    );
    global.browser.storage.local.set = jest.fn((obj) =>
      Promise.resolve().then(() => {
        Object.assign(store, obj);
      }),
    );

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    SaveHistory.add({ url: "https://a/3" });
    await flushWrites();

    expect(store[HISTORY_KEY].map((e) => e.url).toSorted()).toEqual([
      "https://a/1",
      "https://a/2",
      "https://a/3",
    ]);
  });

  test("a failing set does not break subsequent adds", async () => {
    global.browser.storage.local.set = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation((obj) => {
        Object.assign(store, obj);
        return Promise.resolve();
      });

    SaveHistory.add({ url: "https://a/1" });
    SaveHistory.add({ url: "https://a/2" });
    await flushWrites();

    expect(store[HISTORY_KEY].map((e) => e.url)).toEqual(["https://a/2"]);
  });
});
