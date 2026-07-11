import type {
  StorageReader,
  StorageRemover,
  StorageSetter,
  StorageWriter,
} from "./storage-areas.ts";

// Serialized writes are explicit state; storage capability is supplied by the caller.

export type SessionWriteState = {
  queue: Promise<unknown>;
};

export const getSession = <T>(
  storage: StorageReader | undefined,
  key: string,
): Promise<Record<string, T | undefined>> =>
  storage
    ? storage.get(key).then(
        (stored) => stored as Record<string, T | undefined>,
        () => ({}),
      )
    : Promise.resolve({});

export const setSession = (storage: StorageSetter | undefined, obj: Record<string, unknown>) =>
  storage ? storage.set(obj).catch(() => {}) : Promise.resolve();

export const removeSession = (storage: StorageRemover | undefined, key: string | string[]) =>
  storage ? storage.remove(key).catch(() => {}) : Promise.resolve();

export const updateSession = <T>(
  writes: SessionWriteState,
  storage: StorageWriter | undefined,
  key: string,
  update: (value: T | undefined) => T,
) => {
  writes.queue = writes.queue
    .then(() => getSession<T>(storage, key))
    .then((stored) => setSession(storage, { [key]: update(stored[key]) }))
    .catch(() => {});
  return writes.queue;
};
