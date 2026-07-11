// storage.session wrapper: persists MV3 service-worker state across restarts
// and serializes read-modify-write operations so concurrent events do not lose updates.

export class SessionStateStore {
  queue: Promise<unknown> = Promise.resolve();

  available() {
    return typeof browser !== "undefined" && browser.storage && browser.storage.session != null;
  }

  get(key): Promise<Record<string, any>> {
    return this.available()
      ? browser.storage.session.get(key).catch(() => ({}))
      : Promise.resolve({});
  }

  set(obj) {
    return this.available() ? browser.storage.session.set(obj).catch(() => {}) : Promise.resolve();
  }

  remove(key) {
    return this.available()
      ? browser.storage.session.remove(key).catch(() => {})
      : Promise.resolve();
  }

  update(key, fn) {
    this.queue = this.queue
      .then(() => this.get(key))
      .then((res) => this.set({ [key]: fn(res[key]) }))
      .catch(() => {});
    return this.queue;
  }
}
