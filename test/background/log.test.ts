const LOG_KEY = "si-log";
import type { LogEntry } from "../../src/background/log.ts";

type LogStore = Record<string, unknown>;

const setupSession = () => {
  const store: LogStore = {};
  // @types type storage.session as read-only; assigning a partial mock is the
  // test's job, so cast the container
  (global.browser.storage as any).session = {
    get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
    set: vi.fn((obj: Record<string, LogEntry[]>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  };
  return store;
};

describe("Log", () => {
  let Log: typeof import("../../src/background/log.ts");
  let store: LogStore;
  const entries = (): LogEntry[] =>
    Array.isArray(store[LOG_KEY]) ? (store[LOG_KEY] as LogEntry[]) : [];

  beforeEach(async () => {
    vi.resetModules();
    store = setupSession();
    Log = await import("../../src/background/log.ts");
  });

  test("appends timestamped entries", async () => {
    await Log.addLogEntry("download requested", { url: "https://a/1" });
    await Log.addLogEntry("download complete", { id: 7 });

    expect(entries()).toHaveLength(2);
    expect(entries()[0]!.message).toBe("download requested");
    expect(entries()[0]!.data).toBe('{"url":"https://a/1"}');
    expect(entries()[0]!.at).toEqual(expect.any(String));
    expect(entries()[1]!.message).toBe("download complete");
  });

  test("does not persist diagnostics from private browsing", async () => {
    await Log.addLogEntry(
      "download requested",
      { url: "https://private.example/secret" },
      { privateContext: true },
    );

    expect(entries()).toEqual([]);
    expect(global.browser.storage.session.get).not.toHaveBeenCalled();
    expect(global.browser.storage.session.set).not.toHaveBeenCalled();
  });

  test("caps the ring buffer", async () => {
    store[LOG_KEY] = Array.from({ length: Log.LOG_LIMIT }, (_, i) => ({
      at: "t",
      message: `m${i}`,
    }));

    await Log.addLogEntry("newest");

    expect(entries()).toHaveLength(Log.LOG_LIMIT);
    expect(entries()[0]!.message).toBe("m1");
    expect(entries()[Log.LOG_LIMIT - 1]!.message).toBe("newest");
  });

  test("serializes unstringifiable data without throwing", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await Log.addLogEntry("weird", circular);
    expect(entries()[0]!.message).toBe("weird");
    expect(typeof entries()[0]!.data).toBe("string");
  });

  test("contains values that reject both JSON and string conversion", async () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("conversion blocked");
        },
      },
    );

    await expect(Log.addLogEntry("hostile", hostile)).resolves.toBeUndefined();
    expect(entries()[0]).toMatchObject({ message: "hostile", data: "[Unserializable]" });
  });

  test("truncates oversized data payloads", async () => {
    await Log.addLogEntry("big", { blob: "x".repeat(5000) });
    expect(entries()[0]!.data?.length).toBeLessThanOrEqual(501);
  });

  test("concurrent adds do not lose entries", async () => {
    await Promise.all([Log.addLogEntry("a"), Log.addLogEntry("b"), Log.addLogEntry("c")]);
    expect(entries().map((entry) => entry.message)).toEqual(["a", "b", "c"]);
  });

  test("get returns entries, or empty when unset", async () => {
    await expect(Log.getLogEntries()).resolves.toEqual([]);
    await Log.addLogEntry("one");
    await expect(Log.getLogEntries()).resolves.toHaveLength(1);
  });

  test("normalizes malformed and legacy session entries", async () => {
    store[LOG_KEY] = [
      { at: "2026-01-01T00:00:00.000Z", message: "kept", data: "details" },
      { at: 7, message: "bad timestamp" },
      { at: "2026-01-01T00:00:00.000Z", message: 8 },
      null,
    ];

    await expect(Log.getLogEntries()).resolves.toEqual([
      { at: "2026-01-01T00:00:00.000Z", message: "kept", data: "details" },
    ]);

    await Log.addLogEntry("new");
    expect(entries().map(({ message }) => message)).toEqual(["kept", "new"]);

    store[LOG_KEY] = { legacy: true };
    await expect(Log.getLogEntries()).resolves.toEqual([]);
    await Log.addLogEntry("recovered");
    expect(entries().map(({ message }) => message)).toEqual(["recovered"]);
  });

  test("clear empties the log", async () => {
    await Log.addLogEntry("one");
    await Log.clearLog();
    await expect(Log.getLogEntries()).resolves.toEqual([]);
  });

  // An add already holds the pre-clear entries and is about to write them back,
  // so a clear that does not follow it hands them all back to the user.
  test("clear is serialized after already queued writes", async () => {
    await Log.addLogEntry("secret-diagnostic");

    const queuedAdd = Log.addLogEntry("in-flight");
    await Log.clearLog();
    await queuedAdd;

    await expect(Log.getLogEntries()).resolves.toEqual([]);
  });

  // Clearing is an explicit user action, so its failure has to reach the
  // diagnostics panel rather than report a removal that did not happen — and
  // must not leave the queue holding a rejection for the next writer.
  test("a failed clear surfaces to the caller without poisoning the queue", async () => {
    await Log.addLogEntry("one");
    vi.mocked(global.browser.storage.session!.remove).mockRejectedValueOnce(
      new Error("remove denied"),
    );

    await expect(Log.clearLog()).rejects.toThrow("remove denied");

    await Log.addLogEntry("after");
    expect(entries().map(({ message }) => message)).toEqual(["one", "after"]);
  });

  test("is a no-op without storage.session (older Firefox)", async () => {
    (global.browser.storage as any).session = undefined;
    vi.resetModules();
    const BareLog = await import("../../src/background/log.ts");

    await expect(BareLog.addLogEntry("x")).resolves.toBeUndefined();
    await expect(BareLog.getLogEntries()).resolves.toEqual([]);
    await expect(BareLog.clearLog()).resolves.toBeUndefined();
  });

  test("get returns [] when the read fails", async () => {
    vi.mocked(global.browser.storage.session.get).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.getLogEntries()).resolves.toEqual([]);
  });

  test("add swallows storage failures and keeps the queue alive", async () => {
    // A failed write drops that entry but must not break the serialized queue
    // for later adds (SessionState.update swallows the rejection)
    vi.mocked(global.browser.storage.session.set).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.addLogEntry("lost")).resolves.toBeUndefined();
    await Log.addLogEntry("kept");

    expect(entries().map((entry) => entry.message)).toEqual(["kept"]);
  });

  test("clear surfaces storage failures", async () => {
    vi.mocked(global.browser.storage.session.remove).mockRejectedValueOnce(new Error("gone"));

    await expect(Log.clearLog()).rejects.toThrow("gone");
  });
});
