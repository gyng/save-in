// A monotonic download counter backing the :counter: path variable. Persisted
// in storage.local so it survives service-worker restarts, with a serialised
// read-modify-write so concurrent downloads never get the same number.

const COUNTER_KEY = "save-in-counter";

const Counter = {
  KEY: COUNTER_KEY,

  // Serialise writes: a concurrent read-modify-write would hand out duplicates
  writeQueue: Promise.resolve(),

  // Atomically increments the stored counter and resolves to the new value
  next: () => {
    Counter.writeQueue = Counter.writeQueue
      .then(() => browser.storage.local.get(COUNTER_KEY))
      .then((res) => {
        const value = ((res && res[COUNTER_KEY]) || 0) + 1;
        return browser.storage.local.set({ [COUNTER_KEY]: value }).then(() => value);
      });
    return Counter.writeQueue;
  },

  // The current value without consuming one (for the options-page preview)
  peek: () => browser.storage.local.get(COUNTER_KEY).then((res) => (res && res[COUNTER_KEY]) || 0),

  // Resets the counter to 0 (exposed for the options page and tests)
  reset: () => {
    Counter.writeQueue = Counter.writeQueue.then(() =>
      browser.storage.local.set({ [COUNTER_KEY]: 0 }),
    );
    return Counter.writeQueue;
  },
};

if (typeof module !== "undefined") {
  module.exports = Counter;
}
