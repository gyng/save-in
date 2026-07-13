// Counter: an atomic, persistent, serialised download counter for :counter:

import {
  nextCounter,
  nextPrivateCounter,
  peekCounter,
  resetCounter,
} from "../src/background/counter.ts";
import type { CounterWriteState } from "../src/background/counter.ts";

let writes: CounterWriteState;

// A tiny in-memory storage.local stand-in
const makeStore = () => {
  const data: Record<string, number> = {};
  return {
    data,
    get: vi.fn((key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {})),
    set: vi.fn((obj: Record<string, number>) => {
      Object.assign(data, obj);
      return Promise.resolve();
    }),
  };
};

beforeEach(() => {
  writes = { queue: Promise.resolve() };
  (global.browser.storage as any).local = makeStore();
});

describe("Counter", () => {
  test("next() starts at 1 and increments", async () => {
    expect(await nextCounter(writes, browser.storage.local)).toBe(1);
    expect(await nextCounter(writes, browser.storage.local)).toBe(2);
    expect(await nextCounter(writes, browser.storage.local)).toBe(3);
  });

  test("persists across a fresh read (survives SW restart)", async () => {
    await nextCounter(writes, browser.storage.local);
    await nextCounter(writes, browser.storage.local);
    expect(await peekCounter(browser.storage.local)).toBe(2);
    // A later next continues from the stored value
    expect(await nextCounter(writes, browser.storage.local)).toBe(3);
  });

  test("peek() does not consume a value", async () => {
    await nextCounter(writes, browser.storage.local); // -> 1
    expect(await peekCounter(browser.storage.local)).toBe(1);
    expect(await peekCounter(browser.storage.local)).toBe(1);
    expect(await nextCounter(writes, browser.storage.local)).toBe(2);
  });

  test("private counters advance in memory without changing persisted state", async () => {
    await nextCounter(writes, browser.storage.local);
    vi.mocked(browser.storage.local.set).mockClear();

    expect(await nextPrivateCounter(writes, browser.storage.local)).toBe(2);
    expect(await nextPrivateCounter(writes, browser.storage.local)).toBe(3);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(await peekCounter(browser.storage.local)).toBe(1);
  });

  test("a regular counter advances past values used privately", async () => {
    expect(await nextCounter(writes, browser.storage.local)).toBe(1);
    expect(await nextPrivateCounter(writes, browser.storage.local)).toBe(2);
    expect(await nextPrivateCounter(writes, browser.storage.local)).toBe(3);

    expect(await nextCounter(writes, browser.storage.local)).toBe(4);
    expect(await peekCounter(browser.storage.local)).toBe(4);
  });

  test("concurrent next() calls get distinct, gapless values", async () => {
    const results = await Promise.all([
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
    ]);
    expect(results).toHaveLength(5);
    expect(new Set(results)).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  test("reset() sets it back to 0", async () => {
    await nextCounter(writes, browser.storage.local);
    await nextCounter(writes, browser.storage.local);
    await resetCounter(writes, browser.storage.local);
    expect(await peekCounter(browser.storage.local)).toBe(0);
    expect(await nextCounter(writes, browser.storage.local)).toBe(1);
  });

  test("reset() is serialized after an already queued private increment", async () => {
    await nextCounter(writes, browser.storage.local);

    const privateIncrement = nextPrivateCounter(writes, browser.storage.local);
    const reset = resetCounter(writes, browser.storage.local);

    expect(await privateIncrement).toBe(2);
    await reset;
    expect(await peekCounter(browser.storage.local)).toBe(0);
    expect(await nextCounter(writes, browser.storage.local)).toBe(1);
  });

  test("normalizes malformed persisted counters", async () => {
    const storage = {
      get: vi.fn(() => Promise.resolve({ "save-in-counter": "corrupt" })),
      set: vi.fn(() => Promise.resolve()),
    };
    expect(await peekCounter(storage)).toBe(0);
    expect(await nextCounter(writes, storage)).toBe(1);
  });
});
