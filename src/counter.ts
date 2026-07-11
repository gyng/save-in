// A monotonic download counter backing the :counter: path variable. Persisted
// in storage.local so it survives service-worker restarts, with a serialised
// read-modify-write so concurrent downloads never get the same number.

const COUNTER_KEY = "save-in-counter";

export const Counter = {
  KEY: COUNTER_KEY,

  // Serialise writes: a concurrent read-modify-write would hand out duplicates.
  // Typed loosely because the chained value differs per op (next → the new
  // count, reset → void); each method annotates the result it returns.
  writeQueue: Promise.resolve() as Promise<unknown>,

  // Atomically increments the stored counter and resolves to the new value.
  // Returns the freshly-chained promise (typed to the count) rather than the
  // shared writeQueue field, whose Promise<void> initializer would otherwise
  // erase the number the caller awaits (`opts.counter = await Counter.next()`).
  next: (): Promise<number> => {
    const result = Counter.writeQueue
      .then(() => browser.storage.local.get(COUNTER_KEY))
      .then((res) => {
        const value: number = ((res && res[COUNTER_KEY]) || 0) + 1;
        return browser.storage.local.set({ [COUNTER_KEY]: value }).then(() => value);
      });
    Counter.writeQueue = result;
    return result;
  },

  // The current value without consuming one (for the options-page preview)
  peek: (): Promise<number> =>
    browser.storage.local.get(COUNTER_KEY).then((res) => (res && res[COUNTER_KEY]) || 0),

  // Resets the counter to 0 (exposed for the options page and tests)
  reset: () => {
    Counter.writeQueue = Counter.writeQueue.then(() =>
      browser.storage.local.set({ [COUNTER_KEY]: 0 }),
    );
    return Counter.writeQueue;
  },
};
