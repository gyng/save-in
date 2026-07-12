import type { StorageReader, StorageWriter } from "../platform/storage-areas.ts";
export { COUNTER_KEY } from "../shared/storage-keys.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { normalizeSessionCounter } from "./session-state.ts";

export type CounterWriteState = {
  queue: Promise<unknown>;
};

export const nextCounter = (writes: CounterWriteState, storage: StorageWriter): Promise<number> => {
  const result = writes.queue
    .then(() => storage.get(COUNTER_KEY))
    .then((stored) => {
      const value = normalizeSessionCounter(stored?.[COUNTER_KEY]) + 1;
      return storage.set({ [COUNTER_KEY]: value }).then(() => value);
    });
  writes.queue = result;
  return result;
};

export const peekCounter = (storage: StorageReader): Promise<number> =>
  storage.get(COUNTER_KEY).then((stored) => normalizeSessionCounter(stored?.[COUNTER_KEY]));

export const resetCounter = (writes: CounterWriteState, storage: StorageWriter) => {
  writes.queue = writes.queue.then(() => storage.set({ [COUNTER_KEY]: 0 }));
  return writes.queue;
};
