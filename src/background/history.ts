import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";
import {
  hasLegacyDateOnlyTimestamp,
  migrateLegacyHistoryTimestamps,
  normalizeHistory,
} from "./history-normalization.ts";

/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
const HISTORY_LIMIT = 10000;

const recordHistoryFailure = (operation: "read" | "write" | "migrate", error: unknown): void => {
  recordPersistenceFailure({ area: "local", operation, key: HISTORY_KEY }, error);
};

export const SaveHistory = {
  LIMIT: HISTORY_LIMIT,

  // Serialise writes: concurrent read-modify-write would drop entries
  writeQueue: Promise.resolve() as Promise<unknown>,
  idCounter: 0,

  // A short, process-unique id so a later setStatus can find this entry
  nextId: (): string => {
    SaveHistory.idCounter += 1;
    return `h${Date.now()}-${SaveHistory.idCounter}`;
  },

  // Returns the entry id synchronously (the write itself is queued) so the
  // caller can update the entry's status once the download resolves
  add: (entry: HistoryEntryInput): string => {
    const id = SaveHistory.nextId();
    const withMeta = Object.assign({ id, status: "pending" }, entry);

    SaveHistory.writeQueue = SaveHistory.writeQueue
      .then(() => webExtensionApi.storage.local.get(HISTORY_KEY))
      .then((res) => {
        const history = normalizeHistory(res?.[HISTORY_KEY]);
        return webExtensionApi.storage.local.set({
          [HISTORY_KEY]: [...history, withMeta].slice(-HISTORY_LIMIT),
        });
      })
      .catch((error) => recordHistoryFailure("write", error));

    return id;
  },

  // Serialised patch of one entry by id (concurrent read-modify-write drops
  // entries, so it goes through the same queue as add())
  patch: (id: string | null | undefined, fields: Partial<HistoryEntry>): Promise<unknown> => {
    if (!id) {
      return SaveHistory.writeQueue;
    }
    SaveHistory.writeQueue = SaveHistory.writeQueue
      .then(() => webExtensionApi.storage.local.get(HISTORY_KEY))
      .then((res) => {
        const history = normalizeHistory(res?.[HISTORY_KEY]);
        const next = history.map((e) => (e.id === id ? Object.assign({}, e, fields) : e));
        return webExtensionApi.storage.local.set({ [HISTORY_KEY]: next });
      })
      .catch((error) => recordHistoryFailure("write", error));

    return SaveHistory.writeQueue;
  },

  // Records the final outcome ("complete" or a browser error name), the browser
  // download id (so the options page can open the file's folder or poll
  // progress), and the file size in bytes when known
  setStatus: (
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
    return SaveHistory.patch(id, fields);
  },

  // Binds the browser download id to the entry as soon as the download starts,
  // so the options page can poll its progress while it is still in flight
  setDownloadId: (id: string | null | undefined, downloadId: number) =>
    SaveHistory.patch(id, { downloadId }),

  get: async (): Promise<HistoryEntry[]> => {
    let current: Record<string, unknown>;
    try {
      current = ((await webExtensionApi.storage.local.get(HISTORY_KEY)) || {}) as Record<
        string,
        unknown
      >;
    } catch (error) {
      recordHistoryFailure("read", error);
      throw error;
    }
    const stored = current[HISTORY_KEY];
    const history = normalizeHistory(stored);
    if (hasLegacyDateOnlyTimestamp(stored)) {
      SaveHistory.writeQueue = SaveHistory.writeQueue
        .then(() => webExtensionApi.storage.local.get(HISTORY_KEY))
        .then((latest) => {
          const latestStored = latest?.[HISTORY_KEY];
          if (!hasLegacyDateOnlyTimestamp(latestStored)) return;
          return webExtensionApi.storage.local.set({
            [HISTORY_KEY]: migrateLegacyHistoryTimestamps(latestStored),
          });
        })
        .catch((error) => recordHistoryFailure("migrate", error));
      await SaveHistory.writeQueue;
    }
    return history;
  },
};
