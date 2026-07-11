// Per-download records are mirrored in memory and storage.session. Each store
// owns its map and hydration lifecycle; production exports one shared instance.

import { getSession, SessionWriteState, updateSession } from "./session-state.ts";

export class DownloadStateStore {
  readonly SESSION_KEY = "siDownloads";
  readonly MAX = 50;
  records = new Map();
  hydration: Promise<any> | null = null;

  constructor(
    private readonly sessionWrites: SessionWriteState,
    private readonly sessionStorage: () => any,
  ) {}

  hydrate() {
    if (!this.hydration) {
      this.hydration = getSession(this.sessionStorage(), this.SESSION_KEY).then((res) => {
        const store = res[this.SESSION_KEY] || {};
        Object.keys(store).forEach((id) => {
          if (!this.records.has(Number(id))) this.records.set(Number(id), store[id]);
        });
      });
    }
    return this.hydration;
  }

  cap(obj) {
    const keys = Object.keys(obj);
    if (keys.length > this.MAX) delete obj[keys[0]];
    return obj;
  }

  merge(downloadId, partial) {
    const merged = Object.assign({}, this.records.get(downloadId), partial);
    this.records.set(downloadId, merged);
    if (this.records.size > this.MAX) this.records.delete(this.records.keys().next().value);
    return updateSession(this.sessionWrites, this.sessionStorage(), this.SESSION_KEY, (store) =>
      this.cap(Object.assign({}, store, { [downloadId]: merged })),
    );
  }

  get(downloadId) {
    const inMemory = this.records.get(downloadId);
    if (inMemory) return Promise.resolve(inMemory);
    return getSession(this.sessionStorage(), this.SESSION_KEY).then((res) => {
      const store = res[this.SESSION_KEY];
      return (store && store[downloadId]) || null;
    });
  }
}
