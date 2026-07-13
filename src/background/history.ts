import { webExtensionApi } from "../platform/web-extension-api.ts";
import type { HistoryEntry, HistoryEntryInput } from "../shared/history-types.ts";
import { recordPersistenceFailure } from "../shared/persistence-diagnostics.ts";

/* eslint-disable no-unused-vars */

const HISTORY_KEY = "save-in-history";

// Entries store the whole download state: cap the list so storage.local
// does not grow without bound
const HISTORY_LIMIT = 10000;

const recordHistoryFailure = (operation: "read" | "write" | "migrate", error: unknown): void => {
  recordPersistenceFailure({ area: "local", operation, key: HISTORY_KEY }, error);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const normalizeHistoryInfo = (value: unknown) => {
  if (!isObject(value)) return undefined;
  const info: NonNullable<HistoryEntry["info"]> = {};
  for (const key of ["sourceUrl", "pageUrl", "context"] as const) {
    if (typeof value[key] === "string") info[key] = value[key];
  }
  return Object.keys(info).length ? info : undefined;
};

const normalizeStringRecord = (value: unknown): Record<string, string> | undefined => {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
};

const LEGACY_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const normalizeHistoryTimestamp = (value: string): string => {
  const match = value.match(LEGACY_DATE_ONLY);
  if (!match) return value;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const localMidnight = new Date(year, month, day);
  if (
    localMidnight.getFullYear() !== year ||
    localMidnight.getMonth() !== month ||
    localMidnight.getDate() !== day
  ) {
    return value;
  }
  return localMidnight.toISOString();
};

const normalizeHistoryEntry = (value: unknown): HistoryEntry | null => {
  if (!isObject(value) || (value.id !== undefined && typeof value.id !== "string")) return null;

  const entry: HistoryEntry = {};
  for (const key of ["id", "status", "timestamp", "initiatedAt", "url", "finalFullPath"] as const) {
    if (typeof value[key] === "string") {
      entry[key] =
        key === "timestamp" || key === "initiatedAt"
          ? normalizeHistoryTimestamp(value[key])
          : value[key];
    }
  }
  for (const key of ["routed", "observedBrowserDownload"] as const) {
    if (typeof value[key] === "boolean") entry[key] = value[key];
  }
  if (
    typeof value.mechanism === "string" &&
    ["downloads-api", "fetch-downloads-api", "browser-download", "firefox-replacement"].includes(
      value.mechanism,
    )
  ) {
    entry.mechanism = value.mechanism as NonNullable<HistoryEntry["mechanism"]>;
  }
  if (typeof value.downloadId === "number" && Number.isSafeInteger(value.downloadId)) {
    entry.downloadId = value.downloadId;
  }
  if (typeof value.fileSize === "number" && Number.isFinite(value.fileSize)) {
    entry.fileSize = value.fileSize;
  }
  const info = normalizeHistoryInfo(value.info);
  if (info) entry.info = info;
  if (isObject(value.state)) {
    const stateInfo = normalizeHistoryInfo(value.state.info);
    if (stateInfo) entry.state = { info: stateInfo };
  }
  if (isObject(value.menu)) {
    const menu: NonNullable<HistoryEntry["menu"]> = {};
    for (const key of ["id", "title", "path"] as const) {
      if (typeof value.menu[key] === "string") menu[key] = value.menu[key];
    }
    if (Object.keys(menu).length) entry.menu = menu;
  }
  const variables = normalizeStringRecord(value.variables);
  if (variables) entry.variables = variables;
  return entry;
};

const normalizeHistory = (value: unknown): HistoryEntry[] =>
  Array.isArray(value)
    ? value.map(normalizeHistoryEntry).filter((entry): entry is HistoryEntry => entry != null)
    : [];

const hasLegacyDateOnlyTimestamp = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.some(
    (entry) =>
      isObject(entry) &&
      [entry.timestamp, entry.initiatedAt].some(
        (timestamp) =>
          typeof timestamp === "string" && normalizeHistoryTimestamp(timestamp) !== timestamp,
      ),
  );

const migrateLegacyHistoryTimestamps = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value.map((entry) => {
        if (!isObject(entry)) return entry;
        const migrated = { ...entry };
        for (const key of ["timestamp", "initiatedAt"] as const) {
          if (typeof migrated[key] === "string") {
            migrated[key] = normalizeHistoryTimestamp(migrated[key]);
          }
        }
        return migrated;
      })
    : [];

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
