import { mergeDownload } from "../src/download-state.ts";
import { updateSession } from "../src/session-state.ts";
import { BackgroundState } from "../src/background-state.ts";

describe("state service instances", () => {
  test("the production views belong to one immutable application state", () => {
    expect(Object.isFrozen(BackgroundState)).toBe(true);
  });

  test("session stores own independent serialization queues", async () => {
    const first = { queue: Promise.resolve() };
    const second = { queue: Promise.resolve() };
    const storage = {
      get: vi.fn(() => Promise.resolve({ value: 1 })),
      set: vi.fn(() => Promise.resolve()),
    };

    await updateSession(first, storage, "value", (value) => value + 1);

    expect(storage.set).toHaveBeenCalledWith({ value: 2 });
    expect(second.queue).not.toBe(first.queue);
  });

  test("download stores own independent maps and hydration", async () => {
    const writes = { queue: Promise.resolve() };
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
});
