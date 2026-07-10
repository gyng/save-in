/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
const HISTORY_LIMIT = 100;

const SaveHistory = {
  // Serialise writes: concurrent read-modify-write would drop entries
  writeQueue: Promise.resolve(),
  idCounter: 0,

  // A short, process-unique id so a later setStatus can find this entry
  nextId: () => {
    SaveHistory.idCounter += 1;
    return `h${Date.now()}-${SaveHistory.idCounter}`;
  },

  // Returns the entry id synchronously (the write itself is queued) so the
  // caller can update the entry's status once the download resolves
  add: (entry) => {
    const id = SaveHistory.nextId();
    const withMeta = Object.assign({ id, status: "pending" }, entry);

    SaveHistory.writeQueue = SaveHistory.writeQueue
      .then(() => browser.storage.local.get(HISTORY_KEY))
      .then((res) => {
        const history = (res && res[HISTORY_KEY]) || [];
        return browser.storage.local.set({
          [HISTORY_KEY]: [...history, withMeta].slice(-HISTORY_LIMIT),
        });
      })
      .catch(() => {});

    return id;
  },

  // Records the final outcome ("complete" or a browser error name) against
  // the entry created by add()
  setStatus: (id, status) => {
    if (!id) {
      return SaveHistory.writeQueue;
    }
    SaveHistory.writeQueue = SaveHistory.writeQueue
      .then(() => browser.storage.local.get(HISTORY_KEY))
      .then((res) => {
        const history = (res && res[HISTORY_KEY]) || [];
        const next = history.map((e) => (e.id === id ? Object.assign({}, e, { status }) : e));
        return browser.storage.local.set({ [HISTORY_KEY]: next });
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
