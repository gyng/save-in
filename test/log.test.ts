const LOG_KEY = "si-log";
import type { LogEntry } from "../src/background/log.ts";

type LogStore = Record<string, LogEntry[] | undefined>;

const setupSession = () => {
  const store: LogStore = {};
  // @types type storage.session as read-only; assigning a partial mock is the
  // test's job, so cast the container
  (global.browser.storage as any).session = {
    get: jest.fn((key: string) => Promise.resolve({ [key]: store[key] })),
    set: jest.fn((obj: Record<string, LogEntry[]>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    }),
    remove: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  };
  return store;
};

describe("Log", () => {
  let Log: typeof import("../src/background/log.ts").Log;
  let store: LogStore;
  const entries = (): LogEntry[] => store[LOG_KEY] ?? [];

  beforeEach(async () => {
    jest.resetModules();
    store = setupSession();
    Log = (await import("../src/background/log.ts")).Log;
  });

  test("appends timestamped entries", async () => {
    await Log.add("download requested", { url: "https://a/1" });
    await Log.add("download complete", { id: 7 });

    expect(entries()).toHaveLength(2);
    expect(entries()[0].message).toBe("download requested");
    expect(entries()[0].data).toBe('{"url":"https://a/1"}');
    expect(entries()[0].at).toEqual(expect.any(String));
    expect(entries()[1].message).toBe("download complete");
  });

  test("does not persist diagnostics from private browsing", async () => {
    await Log.add(
      "download requested",
      { url: "https://private.example/secret" },
      { privateContext: true },
    );

    expect(entries()).toEqual([]);
    expect(global.browser.storage.session.get).not.toHaveBeenCalled();
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("caps the ring buffer", async () => {
    store[LOG_KEY] = Array.from({ length: Log.LIMIT }, (_, i) => ({
      at: "t",
      message: `m${i}`,
    }));

    await Log.add("newest");

    expect(entries()).toHaveLength(Log.LIMIT);
    expect(entries()[0].message).toBe("m1");
    expect(entries()[Log.LIMIT - 1].message).toBe("newest");
  });

  test("serializes unstringifiable data without throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await Log.add("weird", circular);
    expect(entries()[0].message).toBe("weird");
    expect(typeof entries()[0].data).toBe("string");
  });

  test("truncates oversized data payloads", async () => {
    await Log.add("big", { blob: "x".repeat(5000) });
    expect(entries()[0].data?.length).toBeLessThanOrEqual(501);
  });

  test("concurrent adds do not lose entries", async () => {
    await Promise.all([Log.add("a"), Log.add("b"), Log.add("c")]);
    expect(entries().map((entry) => entry.message)).toEqual(["a", "b", "c"]);
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
    (global.browser.storage as any).session = undefined;
    jest.resetModules();
    const BareLog = (await import("../src/background/log.ts")).Log;

    await expect(BareLog.add("x")).resolves.toBeUndefined();
    await expect(BareLog.get()).resolves.toEqual([]);
    await expect(BareLog.clear()).resolves.toBeUndefined();
  });

  test("get returns [] when the read fails", async () => {
    vi.mocked(global.browser.storage.session.get).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.get()).resolves.toEqual([]);
  });

  test("add swallows storage failures and keeps the queue alive", async () => {
    // A failed write drops that entry but must not break the serialized queue
    // for later adds (SessionState.update swallows the rejection)
    vi.mocked(global.browser.storage.session.set).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.add("lost")).resolves.toBeUndefined();
    await Log.add("kept");

    expect(entries().map((entry) => entry.message)).toEqual(["kept"]);
  });

  test("clear swallows storage failures", async () => {
    vi.mocked(global.browser.storage.session.remove).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.clear()).resolves.toBeUndefined();
  });
});
