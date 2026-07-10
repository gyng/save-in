// Counter: an atomic, persistent, serialised download counter for :counter:

const Counter = (await import("../src/counter.js")).default;

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
  Counter.writeQueue = Promise.resolve();
  global.browser.storage.local = makeStore();
});

describe("Counter", () => {
  test("next() starts at 1 and increments", async () => {
    expect(await Counter.next()).toBe(1);
    expect(await Counter.next()).toBe(2);
    expect(await Counter.next()).toBe(3);
  });

  test("persists across a fresh read (survives SW restart)", async () => {
    await Counter.next();
    await Counter.next();
    expect(await Counter.peek()).toBe(2);
    // A later next continues from the stored value
    expect(await Counter.next()).toBe(3);
  });

  test("peek() does not consume a value", async () => {
    await Counter.next(); // -> 1
    expect(await Counter.peek()).toBe(1);
    expect(await Counter.peek()).toBe(1);
    expect(await Counter.next()).toBe(2);
  });

  test("concurrent next() calls get distinct, gapless values", async () => {
    const results = await Promise.all([
      Counter.next(),
      Counter.next(),
      Counter.next(),
      Counter.next(),
      Counter.next(),
    ]);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("reset() sets it back to 0", async () => {
    await Counter.next();
    await Counter.next();
    await Counter.reset();
    expect(await Counter.peek()).toBe(0);
    expect(await Counter.next()).toBe(1);
  });
});
