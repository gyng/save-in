import type {
  StorageReader,
  StorageRemover,
  StorageSetter,
  StorageWriter,
} from "../platform/storage-areas.ts";

export type SessionWriteState = { queues: Map<string, Promise<unknown>> };

export const normalizeSessionCounter = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

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
  const queue = (writes.queues.get(key) || Promise.resolve())
    .then(() => getSession<T>(storage, key))
    .then((stored) => setSession(storage, { [key]: update(stored[key]) }))
    .catch(() => {});
  writes.queues.set(key, queue);
  void queue.finally(() => {
    if (writes.queues.get(key) === queue) writes.queues.delete(key);
  });
  return queue;
};
