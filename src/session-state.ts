import { StorageReader, StorageRemover, StorageSetter, StorageWriter } from "./storage-areas.ts";

// Serialized writes are explicit state; storage capability is supplied by the caller.

export type SessionWriteState = {
  queue: Promise<unknown>;
};

export const getSession = (storage: StorageReader | undefined, key): Promise<Record<string, any>> =>
  storage ? storage.get(key).catch(() => ({})) : Promise.resolve({});

export const setSession = (storage: StorageSetter | undefined, obj) =>
  storage ? storage.set(obj).catch(() => {}) : Promise.resolve();

export const removeSession = (storage: StorageRemover | undefined, key) =>
  storage ? storage.remove(key).catch(() => {}) : Promise.resolve();

export const updateSession = (
  writes: SessionWriteState,
  storage: StorageWriter | undefined,
  key,
  update,
) => {
  writes.queue = writes.queue
    .then(() => getSession(storage, key))
    .then((stored) => setSession(storage, { [key]: update(stored[key]) }))
    .catch(() => {});
  return writes.queue;
};
