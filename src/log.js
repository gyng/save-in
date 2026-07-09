/* eslint-disable no-unused-vars */

// Session-scoped debug log (#159/#216): a small ring buffer in
// storage.session so entries survive MV3 service worker restarts but never
// leave the machine and clear on browser exit. Viewable from the options
// page. No-op where storage.session is unavailable.

const LOG_STORAGE_KEY = "si-log";

const Log = {
  LIMIT: 200,

  // Serialise writes: concurrent read-modify-write would drop entries
  writeQueue: Promise.resolve(),

  available: () =>
    typeof browser !== "undefined" && browser.storage && browser.storage.session != null,

  serialize: (data) => {
    if (typeof data === "undefined") {
      return undefined;
    }
    let s;
    try {
      s = JSON.stringify(data);
    } catch (e) {
      s = String(data);
    }
    return s && s.length > 500 ? `${s.slice(0, 500)}…` : s;
  },

  add: (message, data) => {
    if (!Log.available()) {
      return Promise.resolve();
    }

    const entry = {
      at: new Date().toISOString(),
      message,
      data: Log.serialize(data),
    };

    Log.writeQueue = Log.writeQueue
      .then(() => browser.storage.session.get(LOG_STORAGE_KEY))
      .then((res) => {
        const entries = (res && res[LOG_STORAGE_KEY]) || [];
        return browser.storage.session.set({
          [LOG_STORAGE_KEY]: [...entries, entry].slice(-Log.LIMIT),
        });
      })
      .catch(() => {});

    return Log.writeQueue;
  },

  get: async () => {
    if (!Log.available()) {
      return [];
    }
    const res = await browser.storage.session.get(LOG_STORAGE_KEY).catch(() => ({}));
    return (res && res[LOG_STORAGE_KEY]) || [];
  },

  clear: () => {
    if (!Log.available()) {
      return Promise.resolve();
    }
    return browser.storage.session.remove(LOG_STORAGE_KEY).catch(() => {});
  },
};

// Export for testing
if (typeof module !== "undefined") {
  module.exports = Log;
}
