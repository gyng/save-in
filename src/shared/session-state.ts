import type {
  StorageReader,
  StorageRemover,
  StorageSetter,
  StorageWriter,
} from "../platform/storage-areas.ts";
import { recordPersistenceFailure } from "./persistence-diagnostics.ts";

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
        (error) => {
          recordPersistenceFailure({ area: "session", operation: "read", key }, error);
          return {};
        },
      )
    : Promise.resolve({});

export const setSession = (
  storage: StorageSetter | undefined,
  obj: Record<string, unknown>,
  key = Object.keys(obj).join(","),
) =>
  storage
    ? storage.set(obj).catch((error) => {
        recordPersistenceFailure({ area: "session", operation: "write", key }, error);
      })
    : Promise.resolve();

export const removeSession = (storage: StorageRemover | undefined, key: string | string[]) =>
  storage
    ? storage.remove(key).catch((error) => {
        recordPersistenceFailure({ area: "session", operation: "remove", key: String(key) }, error);
      })
    : Promise.resolve();

export const updateSession = <T>(
  writes: SessionWriteState,
  storage: StorageWriter | undefined,
  key: string,
  update: (value: T | undefined) => T,
) => {
  const queue = (writes.queues.get(key) || Promise.resolve())
    .then(() => getSession<T>(storage, key))
    .then((stored) => setSession(storage, { [key]: update(stored[key]) }, key))
    .catch((error) => {
      recordPersistenceFailure({ area: "session", operation: "update", key }, error);
    });
  writes.queues.set(key, queue);
  void queue.finally(() => {
    if (writes.queues.get(key) === queue) writes.queues.delete(key);
  });
  return queue;
};
