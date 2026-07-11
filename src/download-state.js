// Single owner of the per-download record, keyed by downloadId: an in-memory
// Map mirror plus a storage.session projection (siDownloads) so it survives an
// MV3 service worker restart. Records are updated by field-union MERGE (create
// on first touch), so the two writers — download.js at downloads.download()
// resolution and notification.js at onCreated — converge to the same record
// regardless of arrival order, with no partial-record race.
//
// Owned here rather than on Download/Notifier because Notifier loads before
// Download; both reference this shared global.

const DownloadState = {
  SESSION_KEY: "siDownloads",
  MAX: 50,

  // downloadId (number) -> record. Authoritative when storage.session is
  // unavailable (older Firefox: SessionState no-ops), preserving today's
  // degraded-but-working single-worker-lifetime behavior.
  records: new Map(),

  // Memoized so the map is rebuilt from storage.session exactly once per worker
  // wake. Without this, merge()'s field-union reads an empty map right after a
  // restart and would overwrite a persisted record's other fields (its
  // historyEntryId, url, ...) with just the partial being merged.
  hydration: null,
  hydrate: () => {
    if (!DownloadState.hydration) {
      DownloadState.hydration =
        typeof SessionState === "undefined"
          ? Promise.resolve()
          : SessionState.get(DownloadState.SESSION_KEY).then((res) => {
              const store = res[DownloadState.SESSION_KEY] || {};
              Object.keys(store).forEach((id) => {
                // A live merge that raced ahead of hydration wins — don't stomp it
                if (!DownloadState.records.has(Number(id))) {
                  DownloadState.records.set(Number(id), store[id]);
                }
              });
            });
    }
    return DownloadState.hydration;
  },

  cap: (obj) => {
    const keys = Object.keys(obj);
    if (keys.length > DownloadState.MAX) {
      delete obj[keys[0]];
    }
    return obj;
  },

  // Field-union merge: unknown id creates a record, known id updates it.
  merge: (downloadId, partial) => {
    const merged = Object.assign({}, DownloadState.records.get(downloadId), partial);
    DownloadState.records.set(downloadId, merged);
    if (DownloadState.records.size > DownloadState.MAX) {
      DownloadState.records.delete(DownloadState.records.keys().next().value);
    }
    if (typeof SessionState === "undefined") {
      return Promise.resolve();
    }
    return SessionState.update(DownloadState.SESSION_KEY, (store) =>
      DownloadState.cap(Object.assign({}, store, { [downloadId]: merged })),
    );
  },

  // The record from the in-memory mirror, or the persisted copy after a worker
  // restart wiped the mirror. Resolves null when nothing is known.
  get: (downloadId) => {
    const inMemory = DownloadState.records.get(downloadId);
    if (inMemory) {
      return Promise.resolve(inMemory);
    }
    if (typeof SessionState === "undefined") {
      return Promise.resolve(null);
    }
    return SessionState.get(DownloadState.SESSION_KEY).then((res) => {
      const store = res[DownloadState.SESSION_KEY];
      return (store && store[downloadId]) || null;
    });
  },
};

if (typeof module !== "undefined") {
  module.exports = DownloadState;
}
