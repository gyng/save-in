const SaveHistory = (await import("../src/history.js")).default;

const HISTORY_KEY = "save-in-history";

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
    await SaveHistory.add({ url: "https://a/1" });
    await SaveHistory.add({ url: "https://a/2" });
    await SaveHistory.add({ url: "https://a/3" });

    expect(store[HISTORY_KEY].map((e) => e.url)).toEqual([
      "https://a/1",
      "https://a/2",
      "https://a/3",
    ]);
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

    await SaveHistory.add({ i: 100 });

    expect(store[HISTORY_KEY]).toHaveLength(100);
    expect(store[HISTORY_KEY][0]).toEqual({ i: 1 });
    expect(store[HISTORY_KEY][99]).toEqual({ i: 100 });
  });

  test("add tolerates a storage backend returning nothing", async () => {
    global.browser.storage.local.get.mockResolvedValueOnce(undefined);

    await SaveHistory.add({ url: "https://a/1" });

    expect(store[HISTORY_KEY]).toEqual([{ url: "https://a/1" }]);
  });

  test("get tolerates a storage backend returning nothing", async () => {
    global.browser.storage.local.get.mockResolvedValueOnce(undefined);

    await expect(SaveHistory.get()).resolves.toEqual([]);
  });

  test("concurrent adds do not clobber each other (write-queue serialization)", async () => {
    // Simulate a real storage backend: get() only reflects the store once
    // its own microtask runs, so concurrent adds can interleave their reads
    // and writes unless serialized.
    global.browser.storage.local.get = jest.fn((key) =>
      Promise.resolve().then(() => ({ [key]: store[key] })),
    );
    global.browser.storage.local.set = jest.fn((obj) =>
      Promise.resolve().then(() => {
        Object.assign(store, obj);
      }),
    );

    await Promise.all([
      SaveHistory.add({ url: "https://a/1" }),
      SaveHistory.add({ url: "https://a/2" }),
      SaveHistory.add({ url: "https://a/3" }),
    ]);

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

    await expect(SaveHistory.add({ url: "https://a/1" })).resolves.toBeUndefined();
    await SaveHistory.add({ url: "https://a/2" });

    expect(store[HISTORY_KEY].map((e) => e.url)).toEqual(["https://a/2"]);
  });
});
