/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
const HISTORY_LIMIT = 100;

const SaveHistory = {
  // Serialise writes: concurrent read-modify-write would drop entries
  writeQueue: Promise.resolve(),

  add: (entry) => {
    SaveHistory.writeQueue = SaveHistory.writeQueue
      .then(() => browser.storage.local.get(HISTORY_KEY))
      .then((res) => {
        const history = (res && res[HISTORY_KEY]) || [];
        return browser.storage.local.set({
          [HISTORY_KEY]: [...history, entry].slice(-HISTORY_LIMIT),
        });
      })
      .catch(() => {});

    return SaveHistory.writeQueue;
  },
  get: async () => {
    const current = (await browser.storage.local.get(HISTORY_KEY)) || {};
    return current[HISTORY_KEY] || [];
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = SaveHistory;
}
