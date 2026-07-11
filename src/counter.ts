// A monotonic download counter persisted in storage.local. Each instance owns
// its serialization queue; production exports one shared instance.

const COUNTER_KEY = "save-in-counter";

export class DownloadCounter {
  readonly KEY = COUNTER_KEY;
  writeQueue: Promise<unknown> = Promise.resolve();

  next(): Promise<number> {
    const result = this.writeQueue
      .then(() => browser.storage.local.get(COUNTER_KEY))
      .then((res) => {
        const value: number = ((res && res[COUNTER_KEY]) || 0) + 1;
        return browser.storage.local.set({ [COUNTER_KEY]: value }).then(() => value);
      });
    this.writeQueue = result;
    return result;
  }

  peek(): Promise<number> {
    return browser.storage.local.get(COUNTER_KEY).then((res) => (res && res[COUNTER_KEY]) || 0);
  }

  reset() {
    this.writeQueue = this.writeQueue.then(() => browser.storage.local.set({ [COUNTER_KEY]: 0 }));
    return this.writeQueue;
  }
}
