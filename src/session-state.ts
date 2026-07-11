// storage.session wrapper: persists MV3 service-worker state across restarts
// (globals die between events) and no-ops where storage.session is unavailable
// (older Firefox). One serialized read-modify-write queue so concurrent
// mutations of a key can't drop updates. Shared by Notifier, Download and Log
// (so the wrapper isn't reimplemented per consumer).

export const SessionState = {
  available: () =>
    typeof browser !== "undefined" && browser.storage && browser.storage.session != null,

  /** @returns {Promise<Record<string, any>>} */
  get: (key) =>
    SessionState.available()
      ? browser.storage.session.get(key).catch(() => ({}))
      : Promise.resolve({}),

  set: (obj) =>
    SessionState.available() ? browser.storage.session.set(obj).catch(() => {}) : Promise.resolve(),

  remove: (key) =>
    SessionState.available()
      ? browser.storage.session.remove(key).catch(() => {})
      : Promise.resolve(),

  // Serialised read-modify-write for one session key. Concurrent downloads
  // mutating the same key (the pending counter, the per-URL filename map, the
  // debug log) would otherwise lose updates.
  queue: Promise.resolve(),
  update: (key, fn) => {
    SessionState.queue = SessionState.queue
      .then(() => SessionState.get(key))
      .then((res) => SessionState.set({ [key]: fn(res[key]) }))
      .catch(() => {});
    return SessionState.queue;
  },
};
