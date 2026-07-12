import { hydrateDownloads, mergeDownload } from "../src/downloads/download-state.ts";
import { normalizeSessionCounter, updateSession } from "../src/background/session-state.ts";
import { BackgroundState } from "../src/background/state.ts";

describe("state service instances", () => {
  test("session counters reject malformed and fractional persisted values", () => {
    expect(normalizeSessionCounter("2")).toBe(0);
    expect(normalizeSessionCounter(-1)).toBe(0);
    expect(normalizeSessionCounter(1.5)).toBe(0);
    expect(normalizeSessionCounter(3)).toBe(3);
  });
  test("the production views belong to one immutable application state", () => {
    expect(Object.isFrozen(BackgroundState)).toBe(true);
  });

  test("session stores own independent serialization queues", async () => {
    const first = { queues: new Map<string, Promise<unknown>>() };
    const second = { queues: new Map<string, Promise<unknown>>() };
    const storage = {
      get: vi.fn(() => Promise.resolve({ value: 1 })),
      set: vi.fn(() => Promise.resolve()),
    };

    await updateSession<number>(first, storage, "value", (value) => (value || 0) + 1);

    expect(storage.set).toHaveBeenCalledWith({ value: 2 });
    expect(second.queues).not.toBe(first.queues);
  });

  test("session writes serialize per key without blocking unrelated keys", async () => {
    const writes = { queues: new Map<string, Promise<unknown>>() };
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve));
    const storage = {
      get: vi.fn((key: string) =>
        key === "slow" ? slow.then(() => ({ slow: 1 })) : Promise.resolve({ fast: 1 }),
      ),
      set: vi.fn(() => Promise.resolve()),
    };

    const slowWrite = updateSession<number>(writes, storage, "slow", (value) => (value || 0) + 1);
    await updateSession<number>(writes, storage, "fast", (value) => (value || 0) + 1);

    expect(storage.set).toHaveBeenCalledWith({ fast: 2 });
    expect(storage.set).not.toHaveBeenCalledWith({ slow: 2 });
    releaseSlow();
    await slowWrite;
  });

  test("download stores own independent maps and hydration", async () => {
    const writes = { queues: new Map<string, Promise<unknown>>() };
    const storage = {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    };
    const first = { records: new Map(), hydration: null };
    const second = { records: new Map(), hydration: null };

    await mergeDownload(first, writes, storage, 7, { adopted: true });

    expect(first.records.get(7)).toEqual({ adopted: true });
    expect(second.records.has(7)).toBe(false);
    expect(second.hydration).toBeNull();
  });

  test("download hydration ignores malformed ids and record shapes", async () => {
    const state = { records: new Map(), hydration: null };
    const storage = {
      get: vi.fn(() =>
        Promise.resolve({
          siDownloads: {
            7: { adopted: true },
            9: { adopted: "yes", url: 4, filename: "valid.txt", unknown: "discard" },
            nope: { adopted: true },
            8: "not-a-record",
          },
        }),
      ),
    };

    await hydrateDownloads(state, storage);

    expect([...state.records.entries()]).toEqual([
      [7, { adopted: true }],
      [9, { filename: "valid.txt" }],
    ]);
  });

  test("download hydration accepts a versioned envelope", async () => {
    const state = { records: new Map(), hydration: null };
    const storage = {
      get: vi.fn(() =>
        Promise.resolve({ siDownloads: { version: 1, records: { 4: { adopted: true } } } }),
      ),
    };

    await hydrateDownloads(state, storage);
    expect(state.records.get(4)).toEqual({ adopted: true });
  });

  test("merging a versioned envelope preserves its records and persists the new record", async () => {
    const state = { records: new Map(), hydration: null };
    const writes = { queues: new Map<string, Promise<unknown>>() };
    let persisted: unknown = {
      version: 1,
      records: { 4: { adopted: true, historyEntryId: "h4" } },
    };
    const storage = {
      get: vi.fn(() => Promise.resolve({ siDownloads: persisted })),
      set: vi.fn((value: Record<string, unknown>) => {
        persisted = value.siDownloads;
        return Promise.resolve();
      }),
    };

    await mergeDownload(state, writes, storage, 5, { adopted: true });
    const restarted = { records: new Map(), hydration: null };
    await hydrateDownloads(restarted, storage);

    expect([...restarted.records.entries()]).toEqual([
      [4, { adopted: true, historyEntryId: "h4" }],
      [5, { adopted: true }],
    ]);
  });

  test("download hydration preserves observed browser-download ownership", async () => {
    const state = { records: new Map(), hydration: null };
    const storage = {
      get: vi.fn(() =>
        Promise.resolve({
          siDownloads: { 8: { observedBrowserDownload: true, historyEntryId: "h8" } },
        }),
      ),
    };

    await hydrateDownloads(state, storage);

    expect(state.records.get(8)).toEqual({
      observedBrowserDownload: true,
      historyEntryId: "h8",
    });
  });

  test("persisted download records are capped even when legacy storage is oversized", async () => {
    const state = { records: new Map(), hydration: null };
    const writes = { queues: new Map<string, Promise<unknown>>() };
    const oversized = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [index + 1, { adopted: true }]),
    );
    const storage = {
      get: vi.fn(() => Promise.resolve({ siDownloads: oversized })),
      set: vi.fn<(value: Record<string, any>) => Promise<void>>().mockResolvedValue(),
    };

    await mergeDownload(state, writes, storage, 61, { adopted: true });

    const persisted = vi.mocked(storage.set).mock.calls[0]![0].siDownloads;
    expect(Object.keys(persisted)).toHaveLength(50);
    expect(persisted[61]).toEqual({ adopted: true });
  });
});
