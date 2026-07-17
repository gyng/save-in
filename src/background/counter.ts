import type { StorageReader, StorageWriter } from "../shared/storage-types.ts";
export { COUNTER_KEY } from "../shared/storage-keys.ts";
import { COUNTER_KEY } from "../shared/storage-keys.ts";
import { normalizeSessionCounter } from "../shared/session-state.ts";

export type CounterWriteState = {
  queue: Promise<unknown>;
  privateValue?: number | undefined;
};

// The queue only orders the next read-modify-write after the previous one; it
// must never carry a failure forward. It is shared by every :counter: save for
// the life of the worker, so parking a rejected promise in it would fail every
// later download — long after the storage recovered, and only healed by a
// restart. The caller still sees its own rejection.
const serialize = <T>(writes: CounterWriteState, result: Promise<T>): Promise<T> => {
  writes.queue = result.catch(() => {});
  return result;
};

export const nextCounter = (writes: CounterWriteState, storage: StorageWriter): Promise<number> =>
  serialize(
    writes,
    writes.queue
      .then(() => storage.get(COUNTER_KEY))
      .then((stored) => {
        const persisted = normalizeSessionCounter(stored?.[COUNTER_KEY]);
        const value = Math.max(persisted, writes.privateValue || 0) + 1;
        writes.privateValue = value;
        return storage.set({ [COUNTER_KEY]: value }).then(() => value);
      }),
  );

export const peekCounter = (storage: StorageReader): Promise<number> =>
  storage.get(COUNTER_KEY).then((stored) => normalizeSessionCounter(stored?.[COUNTER_KEY]));

export const nextPrivateCounter = (
  writes: CounterWriteState,
  storage: StorageReader,
): Promise<number> =>
  serialize(
    writes,
    writes.queue.then(async () => {
      const persisted = await peekCounter(storage);
      const value = Math.max(writes.privateValue ?? persisted, persisted) + 1;
      writes.privateValue = value;
      return value;
    }),
  );

export const resetCounter = (writes: CounterWriteState, storage: StorageWriter) =>
  serialize(
    writes,
    writes.queue.then(() => {
      writes.privateValue = 0;
      return storage.set({ [COUNTER_KEY]: 0 });
    }),
  );
