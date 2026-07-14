import type { StorageReader, StorageWriter } from "../platform/storage-areas.ts";
export { COUNTER_KEY } from "../shared/storage-keys.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { normalizeSessionCounter } from "../shared/session-state.ts";

export type CounterWriteState = {
  queue: Promise<unknown>;
  privateValue?: number | undefined;
};

export const nextCounter = (writes: CounterWriteState, storage: StorageWriter): Promise<number> => {
  const result = writes.queue
    .then(() => storage.get(COUNTER_KEY))
    .then((stored) => {
      const persisted = normalizeSessionCounter(stored?.[COUNTER_KEY]);
      const value = Math.max(persisted, writes.privateValue || 0) + 1;
      writes.privateValue = value;
      return storage.set({ [COUNTER_KEY]: value }).then(() => value);
    });
  writes.queue = result;
  return result;
};

export const peekCounter = (storage: StorageReader): Promise<number> =>
  storage.get(COUNTER_KEY).then((stored) => normalizeSessionCounter(stored?.[COUNTER_KEY]));

export const nextPrivateCounter = (
  writes: CounterWriteState,
  storage: StorageReader,
): Promise<number> => {
  const result = writes.queue.then(async () => {
    const persisted = await peekCounter(storage);
    const value = Math.max(writes.privateValue ?? persisted, persisted) + 1;
    writes.privateValue = value;
    return value;
  });
  writes.queue = result;
  return result;
};

export const resetCounter = (writes: CounterWriteState, storage: StorageWriter) => {
  writes.queue = writes.queue.then(() => {
    writes.privateValue = 0;
    return storage.set({ [COUNTER_KEY]: 0 });
  });
  return writes.queue;
};
