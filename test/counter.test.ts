// Counter: an atomic, persistent, serialised download counter for :counter:

import { nextCounter, peekCounter, resetCounter } from "../src/counter.ts";

let writes;

// A tiny in-memory storage.local stand-in
const makeStore = () => {
  const data = {};
  return {
    data,
    get: vi.fn((key) => Promise.resolve(key in data ? { [key]: data[key] } : {})),
    set: vi.fn((obj) => {
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

  test("concurrent next() calls get distinct, gapless values", async () => {
    const results = await Promise.all([
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
      nextCounter(writes, browser.storage.local),
    ]);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("reset() sets it back to 0", async () => {
    await nextCounter(writes, browser.storage.local);
    await nextCounter(writes, browser.storage.local);
    await resetCounter(writes, browser.storage.local);
    expect(await peekCounter(browser.storage.local)).toBe(0);
    expect(await nextCounter(writes, browser.storage.local)).toBe(1);
  });
});
