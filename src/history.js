/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
const HISTORY_LIMIT = 100;

const SaveHistory = {
  add: async (entry) => {
    const current = (await browser.storage.local.get(HISTORY_KEY)) || {};
    const history = current[HISTORY_KEY] || [];
    await browser.storage.local.set({
      [HISTORY_KEY]: [...history, entry].slice(-HISTORY_LIMIT),
    });
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
