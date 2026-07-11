const LOG_KEY = "si-log";

const setupSession = () => {
  const store = {};
  global.browser.storage.session = {
    get: jest.fn((key) => Promise.resolve({ [key]: store[key] })),
    set: jest.fn((obj) => {
      Object.assign(store, obj);
      return Promise.resolve();
    }),
    remove: jest.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
  };
  return store;
};

describe("Log", () => {
  let Log;
  let store;

  beforeEach(async () => {
    jest.resetModules();
    store = setupSession();
    Log = (await import("../src/log.js")).default;
  });

  test("appends timestamped entries", async () => {
    await Log.add("download requested", { url: "https://a/1" });
    await Log.add("download complete", { id: 7 });

    expect(store[LOG_KEY]).toHaveLength(2);
    expect(store[LOG_KEY][0].message).toBe("download requested");
    expect(store[LOG_KEY][0].data).toBe('{"url":"https://a/1"}');
    expect(store[LOG_KEY][0].at).toEqual(expect.any(String));
    expect(store[LOG_KEY][1].message).toBe("download complete");
  });

  test("caps the ring buffer", async () => {
    store[LOG_KEY] = Array.from({ length: Log.LIMIT }, (_, i) => ({
      at: "t",
      message: `m${i}`,
    }));

    await Log.add("newest");

    expect(store[LOG_KEY]).toHaveLength(Log.LIMIT);
    expect(store[LOG_KEY][0].message).toBe("m1");
    expect(store[LOG_KEY][Log.LIMIT - 1].message).toBe("newest");
  });

  test("serializes unstringifiable data without throwing", async () => {
    const circular = {};
    circular.self = circular;

    await Log.add("weird", circular);
    expect(store[LOG_KEY][0].message).toBe("weird");
    expect(typeof store[LOG_KEY][0].data).toBe("string");
  });

  test("truncates oversized data payloads", async () => {
    await Log.add("big", { blob: "x".repeat(5000) });
    expect(store[LOG_KEY][0].data.length).toBeLessThanOrEqual(501);
  });

  test("concurrent adds do not lose entries", async () => {
    await Promise.all([Log.add("a"), Log.add("b"), Log.add("c")]);
    expect(store[LOG_KEY].map((e) => e.message)).toEqual(["a", "b", "c"]);
  });

  test("get returns entries, or empty when unset", async () => {
    await expect(Log.get()).resolves.toEqual([]);
    await Log.add("one");
    await expect(Log.get()).resolves.toHaveLength(1);
  });

  test("clear empties the log", async () => {
    await Log.add("one");
    await Log.clear();
    await expect(Log.get()).resolves.toEqual([]);
  });

  test("is a no-op without storage.session (older Firefox)", async () => {
    global.browser.storage.session = undefined;
    jest.resetModules();
    const BareLog = (await import("../src/log.js")).default;

    await expect(BareLog.add("x")).resolves.toBeUndefined();
    await expect(BareLog.get()).resolves.toEqual([]);
    await expect(BareLog.clear()).resolves.toBeUndefined();
  });

  test("get returns [] when the read fails", async () => {
    global.browser.storage.session.get.mockRejectedValueOnce(new Error("gone"));

    await expect(Log.get()).resolves.toEqual([]);
  });

  test("add swallows storage failures and keeps the queue alive", async () => {
    // A failed write drops that entry but must not break the serialized queue
    // for later adds (SessionState.update swallows the rejection)
    global.browser.storage.session.set.mockRejectedValueOnce(new Error("gone"));

    await expect(Log.add("lost")).resolves.toBeUndefined();
    await Log.add("kept");

    expect(store[LOG_KEY].map((e) => e.message)).toEqual(["kept"]);
  });

  test("clear swallows storage failures", async () => {
    global.browser.storage.session.remove.mockRejectedValueOnce(new Error("gone"));

    await expect(Log.clear()).resolves.toBeUndefined();
  });
});
