import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import type { PrivateWriteOptions } from "../shared/persistence-context.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";
import { HISTORY_STORAGE_KEY } from "../shared/storage-keys.ts";
import {
  hasLegacyDateOnlyTimestamp,
  migrateLegacyHistoryTimestamps,
  normalizeHistory,
} from "../shared/history-normalization.ts";
import { isStringKeyedRecord } from "../shared/util.ts";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
export const HISTORY_LIMIT = 10000;

const recordHistoryFailure = (
  operation: "read" | "write" | "remove" | "migrate",
  error: unknown,
): void => {
  recordPersistenceFailure({ area: "local", operation, key: HISTORY_STORAGE_KEY }, error);
};

// Serialise writes: concurrent read-modify-write would drop entries
let writeQueue: Promise<unknown> = Promise.resolve(undefined);
let idCounter = 0;

// A short, process-unique id so a later setHistoryStatus can find this entry
const nextHistoryId = (): string => {
  idCounter += 1;
  return `h${Date.now()}-${idCounter}`;
};

// Returns the entry id synchronously (the write itself is queued) so the
// caller can update the entry's status once the download resolves
export const addHistoryEntry = (
  entry: HistoryEntryInput,
  writeOptions: PrivateWriteOptions = {},
): string | null => {
  // Chrome and Firefox both expose the originating private context. Private
  // activity must never enter extension storage, even temporarily.
  if (writeOptions.privateContext) return null;

  const id = nextHistoryId();
  const withMeta = Object.assign({ id, status: "pending" }, entry);

  writeQueue = writeQueue
    .then(() => webExtensionApi.storage.local.get(HISTORY_STORAGE_KEY))
    .then((res) => {
      const history = normalizeHistory(res?.[HISTORY_STORAGE_KEY]);
      return webExtensionApi.storage.local.set({
        [HISTORY_STORAGE_KEY]: [...history, withMeta].slice(-HISTORY_LIMIT),
      });
    })
    .catch((error) => recordHistoryFailure("write", error));

  return id;
};

// Serialised patch of one entry by id (concurrent read-modify-write drops
// entries, so it goes through the same queue as addHistoryEntry())
export const patchHistoryEntry = (
  id: string | null | undefined,
  fields: Partial<HistoryEntry>,
): Promise<unknown> => {
  if (!id) {
    return writeQueue;
  }
  writeQueue = writeQueue
    .then(() => webExtensionApi.storage.local.get(HISTORY_STORAGE_KEY))
    .then((res) => {
      const history = normalizeHistory(res?.[HISTORY_STORAGE_KEY]);
      const next = history.map((e) => (e.id === id ? Object.assign({}, e, fields) : e));
      return webExtensionApi.storage.local.set({ [HISTORY_STORAGE_KEY]: next });
    })
    .catch((error) => recordHistoryFailure("write", error));

  return writeQueue;
};

// Records the final outcome ("complete" or a browser error name), the browser
// download id (so the options page can open the file's folder or poll
// progress), and the file size in bytes when known
export const setHistoryStatus = (
  id: string | null | undefined,
  status: string,
  downloadId?: number,
  fileSize?: number,
) => {
  const fields: Partial<HistoryEntry> = { status };
  if (downloadId != null) {
    fields.downloadId = downloadId;
  }
  if (fileSize != null) {
    fields.fileSize = fileSize;
  }
  return patchHistoryEntry(id, fields);
};

// Binds the browser download id to the entry as soon as the download starts,
// so the options page can poll its progress while it is still in flight
export const setHistoryDownloadId = (id: string | null | undefined, downloadId: number) =>
  patchHistoryEntry(id, { downloadId });

export const getHistoryEntries = async (): Promise<HistoryEntry[]> => {
  // Reads requested by the options page must observe every write that was
  // already accepted when the request arrived.
  await writeQueue;
  let current: unknown;
  try {
    current = await webExtensionApi.storage.local.get(HISTORY_STORAGE_KEY);
  } catch (error) {
    recordHistoryFailure("read", error);
    throw error;
  }
  const stored = isStringKeyedRecord(current) ? current[HISTORY_STORAGE_KEY] : undefined;
  const history = normalizeHistory(stored);
  if (hasLegacyDateOnlyTimestamp(stored)) {
    writeQueue = writeQueue
      .then(() => webExtensionApi.storage.local.get(HISTORY_STORAGE_KEY))
      .then((latest) => {
        const latestStored = latest?.[HISTORY_STORAGE_KEY];
        if (!hasLegacyDateOnlyTimestamp(latestStored)) return;
        return webExtensionApi.storage.local.set({
          [HISTORY_STORAGE_KEY]: migrateLegacyHistoryTimestamps(latestStored),
        });
      })
      .catch((error) => recordHistoryFailure("migrate", error));
    await writeQueue;
  }
  return history;
};

export const clearHistory = (): Promise<void> => {
  const task = writeQueue
    .catch(() => {})
    .then(() => webExtensionApi.storage.local.remove(HISTORY_STORAGE_KEY));
  writeQueue = task.catch((error) => recordHistoryFailure("remove", error));
  return task;
};

// Test seams: the write queue is module-private serialised state, so tests
// await it and inject a pre-rejected queue through these helpers rather than
// reaching into the internals.
export const flushHistoryWrites = (): Promise<unknown> => writeQueue;
export const seedHistoryWriteQueueForTest = (queue: Promise<unknown>): void => {
  writeQueue = queue;
};
